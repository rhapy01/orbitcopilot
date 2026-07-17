#![no_std]
//! Orbit NFT Collection — SEP-50 compatible non-fungible tokens + XLM marketplace.
//!
//! Implements the [SEP-50](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0050.md)
//! NonFungibleToken surface so wallets/marketplaces can read name/symbol/token_uri,
//! ownership, transfers, and approvals. Marketplace (list/buy) is an Orbit extension.

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String, Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct Listing {
    pub seller: Address,
    pub price: i128,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Name,
    Symbol,
    BaseUri,
    ContractUri,
    NextId,
    MaxSupply,
    OpenMint,
    PaymentToken,
    Owner(u32),
    TokenUri(u32),
    Balance(Address),
    Approved(u32),
    Operator(Address, Address),
    Listing(u32),
    OwnerTokens(Address),
}

#[contract]
pub struct OrbitNft;

#[contractimpl]
impl OrbitNft {
    /// Initialize a SEP-50 collection.
    /// `max_supply` 0 = unlimited. `open_mint` lets anyone mint to themselves.
    pub fn initialize(
        env: Env,
        admin: Address,
        name: String,
        symbol: String,
        base_uri: String,
        payment_token: Address,
        max_supply: u32,
        open_mint: bool,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::BaseUri, &base_uri);
        env.storage()
            .instance()
            .set(&DataKey::PaymentToken, &payment_token);
        env.storage().instance().set(&DataKey::MaxSupply, &max_supply);
        env.storage().instance().set(&DataKey::OpenMint, &open_mint);
        env.storage().instance().set(&DataKey::NextId, &1u32);
    }

    // ─── SEP-50 metadata ───────────────────────────────────────────────

    pub fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(env: Env) -> String {
        env.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    /// Per-token URI, or collection base_uri when no override is set.
    pub fn token_uri(env: Env, token_id: u32) -> String {
        Self::require_exists(&env, token_id);
        if let Some(uri) = env
            .storage()
            .persistent()
            .get::<_, String>(&DataKey::TokenUri(token_id))
        {
            return uri;
        }
        env.storage()
            .instance()
            .get(&DataKey::BaseUri)
            .unwrap_or(String::from_str(&env, ""))
    }

    /// Optional OpenSea-style collection metadata URI (contractURI).
    pub fn contract_uri(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::ContractUri)
            .unwrap_or(String::from_str(&env, ""))
    }

    pub fn set_contract_uri(env: Env, admin: Address, uri: String) {
        Self::require_admin(&env, &admin);
        env.storage().instance().set(&DataKey::ContractUri, &uri);
    }

    pub fn set_base_uri(env: Env, admin: Address, uri: String) {
        Self::require_admin(&env, &admin);
        env.storage().instance().set(&DataKey::BaseUri, &uri);
    }

    // ─── SEP-50 ownership / balance ────────────────────────────────────

    pub fn balance(env: Env, owner: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(owner))
            .unwrap_or(0u32)
    }

    pub fn owner_of(env: Env, token_id: u32) -> Address {
        Self::require_exists(&env, token_id)
    }

    // ─── SEP-50 transfers & approvals ──────────────────────────────────

    pub fn transfer(env: Env, from: Address, to: Address, token_id: u32) {
        from.require_auth();
        Self::transfer_internal(&env, &from, &to, token_id);
    }

    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        token_id: u32,
    ) {
        spender.require_auth();
        Self::require_approved_or_operator(&env, &spender, &from, token_id);
        Self::transfer_internal(&env, &from, &to, token_id);
    }

    pub fn approve(
        env: Env,
        approver: Address,
        approved: Address,
        token_id: u32,
        live_until_ledger: u32,
    ) {
        approver.require_auth();
        let owner = Self::require_exists(&env, token_id);
        if approver != owner
            && !Self::is_approved_for_all(env.clone(), owner.clone(), approver.clone())
        {
            panic!("not authorized");
        }
        if live_until_ledger > 0 && live_until_ledger < env.ledger().sequence() {
            panic!("expired ledger");
        }
        env.storage().persistent().set(
            &DataKey::Approved(token_id),
            &(approved.clone(), live_until_ledger),
        );
        env.events().publish(
            (symbol_short!("approve"), approver, token_id),
            (approved, live_until_ledger),
        );
    }

    pub fn approve_for_all(
        env: Env,
        owner: Address,
        operator: Address,
        live_until_ledger: u32,
    ) {
        owner.require_auth();
        if live_until_ledger != 0 && live_until_ledger < env.ledger().sequence() {
            panic!("expired ledger");
        }
        if live_until_ledger == 0 {
            env.storage()
                .persistent()
                .remove(&DataKey::Operator(owner.clone(), operator.clone()));
        } else {
            env.storage().persistent().set(
                &DataKey::Operator(owner.clone(), operator.clone()),
                &live_until_ledger,
            );
        }
        env.events().publish(
            (Symbol::new(&env, "approve_for_all"), owner),
            (operator, live_until_ledger),
        );
    }

    pub fn get_approved(env: Env, token_id: u32) -> Option<Address> {
        Self::require_exists(&env, token_id);
        let entry: Option<(Address, u32)> =
            env.storage().persistent().get(&DataKey::Approved(token_id));
        match entry {
            Some((addr, until)) if until == 0 || until >= env.ledger().sequence() => Some(addr),
            _ => None,
        }
    }

    pub fn is_approved_for_all(env: Env, owner: Address, operator: Address) -> bool {
        let until: Option<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::Operator(owner, operator));
        match until {
            Some(u) if u != 0 && u >= env.ledger().sequence() => true,
            _ => false,
        }
    }

    // ─── Mint (Orbit launchpad) ────────────────────────────────────────

    /// Mint to `to`. `name` is accepted for chat/API UX; real display name lives in
    /// the SEP-50 / OpenSea metadata JSON at `uri` (empty uri → collection base_uri).
    pub fn mint(env: Env, to: Address, _name: String, uri: String) -> u32 {
        let open: bool = env
            .storage()
            .instance()
            .get(&DataKey::OpenMint)
            .unwrap_or(false);
        if open {
            to.require_auth();
        } else {
            let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
            admin.require_auth();
        }

        let max: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxSupply)
            .unwrap_or(0);
        let id: u32 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        if max > 0 && id > max {
            panic!("max supply reached");
        }

        env.storage().persistent().set(&DataKey::Owner(id), &to);
        if uri.len() > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::TokenUri(id), &uri);
        }
        Self::inc_balance(&env, &to, 1);
        Self::push_owner_token(&env, &to, id);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        env.events()
            .publish((symbol_short!("mint"), to.clone()), id);

        id
    }

    // ─── Marketplace (Orbit extension) ─────────────────────────────────

    pub fn list_for_sale(env: Env, seller: Address, token_id: u32, price: i128) {
        seller.require_auth();
        if price <= 0 {
            panic!("price must be positive");
        }
        let owner = Self::require_exists(&env, token_id);
        if owner != seller {
            panic!("not owner");
        }
        env.storage().persistent().set(
            &DataKey::Listing(token_id),
            &Listing {
                seller: seller.clone(),
                price,
            },
        );
    }

    pub fn cancel_listing(env: Env, seller: Address, token_id: u32) {
        seller.require_auth();
        let listing: Listing = env
            .storage()
            .persistent()
            .get(&DataKey::Listing(token_id))
            .expect("not listed");
        if listing.seller != seller {
            panic!("not seller");
        }
        env.storage()
            .persistent()
            .remove(&DataKey::Listing(token_id));
    }

    pub fn buy(env: Env, buyer: Address, token_id: u32) {
        buyer.require_auth();
        let listing: Listing = env
            .storage()
            .persistent()
            .get(&DataKey::Listing(token_id))
            .expect("not listed");
        let owner = Self::require_exists(&env, token_id);
        if owner != listing.seller {
            panic!("listing stale");
        }

        let payment: Address = env
            .storage()
            .instance()
            .get(&DataKey::PaymentToken)
            .unwrap();
        let token_client = token::Client::new(&env, &payment);
        token_client.transfer(&buyer, &listing.seller, &listing.price);

        env.storage()
            .persistent()
            .remove(&DataKey::Listing(token_id));
        Self::transfer_internal(&env, &listing.seller, &buyer, token_id);
    }

    pub fn get_listing(env: Env, token_id: u32) -> Option<Listing> {
        env.storage().persistent().get(&DataKey::Listing(token_id))
    }

    pub fn tokens_of(env: Env, owner: Address) -> Vec<u32> {
        env.storage()
            .persistent()
            .get(&DataKey::OwnerTokens(owner))
            .unwrap_or(Vec::new(&env))
    }

    pub fn total_supply(env: Env) -> u32 {
        let next: u32 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        next.saturating_sub(1)
    }

    pub fn max_supply(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MaxSupply)
            .unwrap_or(0)
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    // ─── internals ─────────────────────────────────────────────────────

    fn require_admin(env: &Env, admin: &Address) {
        admin.require_auth();
        let stored: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if &stored != admin {
            panic!("not admin");
        }
    }

    fn require_exists(env: &Env, token_id: u32) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::Owner(token_id))
            .expect("token missing")
    }

    fn require_approved_or_operator(
        env: &Env,
        spender: &Address,
        from: &Address,
        token_id: u32,
    ) {
        if spender == from {
            return;
        }
        if Self::is_approved_for_all(env.clone(), from.clone(), spender.clone()) {
            return;
        }
        let approved = Self::get_approved(env.clone(), token_id);
        if approved.as_ref() != Some(spender) {
            panic!("not approved");
        }
    }

    fn transfer_internal(env: &Env, from: &Address, to: &Address, token_id: u32) {
        let owner = Self::require_exists(env, token_id);
        if &owner != from {
            panic!("not owner");
        }
        env.storage()
            .persistent()
            .remove(&DataKey::Listing(token_id));
        env.storage()
            .persistent()
            .remove(&DataKey::Approved(token_id));
        Self::remove_owner_token(env, from, token_id);
        Self::dec_balance(env, from, 1);
        env.storage()
            .persistent()
            .set(&DataKey::Owner(token_id), to);
        Self::inc_balance(env, to, 1);
        Self::push_owner_token(env, to, token_id);

        env.events().publish(
            (Symbol::new(env, "transfer"), from.clone(), to.clone()),
            token_id,
        );
    }

    fn inc_balance(env: &Env, owner: &Address, amount: u32) {
        let bal = Self::balance(env.clone(), owner.clone()).saturating_add(amount);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(owner.clone()), &bal);
    }

    fn dec_balance(env: &Env, owner: &Address, amount: u32) {
        let bal = Self::balance(env.clone(), owner.clone()).saturating_sub(amount);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(owner.clone()), &bal);
    }

    fn push_owner_token(env: &Env, owner: &Address, token_id: u32) {
        let mut ids: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnerTokens(owner.clone()))
            .unwrap_or(Vec::new(env));
        ids.push_back(token_id);
        env.storage()
            .persistent()
            .set(&DataKey::OwnerTokens(owner.clone()), &ids);
    }

    fn remove_owner_token(env: &Env, owner: &Address, token_id: u32) {
        let ids: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnerTokens(owner.clone()))
            .unwrap_or(Vec::new(env));
        let mut next = Vec::new(env);
        for id in ids.iter() {
            if id != token_id {
                next.push_back(id);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::OwnerTokens(owner.clone()), &next);
    }
}
