#![no_std]
//! Orbit NFT Collection — SEP-50 compatible non-fungible tokens + XLM marketplace.
//!
//! Implements the [SEP-50](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0050.md)
//! NonFungibleToken surface so wallets/marketplaces can read name/symbol/token_uri,
//! ownership, transfers, and approvals. Marketplace (list/buy) is an Orbit extension.
//!
//! Secondary sales (`buy`) split list price:
//! - platform fee (default 0.5%) → Orbit treasury
//! - creator royalty (default 2.5%, max 10%) → collection royalty receiver
//! - remainder → seller

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String, Symbol, Vec,
};

/// 0.5% Orbit platform fee on secondary sales.
pub const DEFAULT_PLATFORM_FEE_BPS: u32 = 50;
/// 2.5% default creator royalty on secondary sales.
pub const DEFAULT_ROYALTY_BPS: u32 = 250;
/// Cap creator royalty at 10% (OpenSea-style).
pub const MAX_ROYALTY_BPS: u32 = 1000;
/// Hard cap platform fee at 5% (safety if misconfigured).
pub const MAX_PLATFORM_FEE_BPS: u32 = 500;

#[contracttype]
#[derive(Clone)]
pub struct Listing {
    pub seller: Address,
    pub price: i128,
}

/// Sale proceeds / fee configuration (basis points: 10_000 = 100%).
#[contracttype]
#[derive(Clone)]
pub struct MarketplaceFeeConfig {
    pub royalty_bps: u32,
    pub royalty_receiver: Address,
    pub platform_fee_bps: u32,
    pub platform_fee_receiver: Address,
}

/// Sale proceeds breakdown (basis points use 10_000 = 100%).
#[contracttype]
#[derive(Clone)]
pub struct SaleFees {
    pub royalty_bps: u32,
    pub royalty_receiver: Address,
    pub platform_fee_bps: u32,
    pub platform_fee_receiver: Address,
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
    RoyaltyBps,
    RoyaltyReceiver,
    PlatformFeeBps,
    PlatformFeeReceiver,
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
    /// Fee bps are in basis points (100 = 1%).
    pub fn initialize(
        env: Env,
        admin: Address,
        name: String,
        symbol: String,
        base_uri: String,
        payment_token: Address,
        max_supply: u32,
        open_mint: bool,
        fees: MarketplaceFeeConfig,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        Self::validate_fees(&fees);
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
        Self::store_fees(&env, &fees);
    }

    /// One-shot / upgrade helper: set marketplace fees when missing or update royalty.
    /// Platform fee receiver can only be set if not already configured (Orbit lock-in).
    pub fn configure_marketplace_fees(env: Env, admin: Address, fees: MarketplaceFeeConfig) {
        Self::require_admin(&env, &admin);
        Self::validate_fees(&fees);
        env.storage()
            .instance()
            .set(&DataKey::RoyaltyBps, &fees.royalty_bps);
        env.storage()
            .instance()
            .set(&DataKey::RoyaltyReceiver, &fees.royalty_receiver);
        if !env.storage().instance().has(&DataKey::PlatformFeeReceiver) {
            env.storage()
                .instance()
                .set(&DataKey::PlatformFeeBps, &fees.platform_fee_bps);
            env.storage()
                .instance()
                .set(&DataKey::PlatformFeeReceiver, &fees.platform_fee_receiver);
        }
    }

    /// Collection admin can adjust creator royalty (0–10%).
    pub fn set_royalty(env: Env, admin: Address, royalty_bps: u32, royalty_receiver: Address) {
        Self::require_admin(&env, &admin);
        if royalty_bps > MAX_ROYALTY_BPS {
            panic!("royalty too high");
        }
        env.storage().instance().set(&DataKey::RoyaltyBps, &royalty_bps);
        env.storage()
            .instance()
            .set(&DataKey::RoyaltyReceiver, &royalty_receiver);
    }

    pub fn sale_fees(env: Env) -> SaleFees {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        SaleFees {
            royalty_bps: env
                .storage()
                .instance()
                .get(&DataKey::RoyaltyBps)
                .unwrap_or(0u32),
            royalty_receiver: env
                .storage()
                .instance()
                .get(&DataKey::RoyaltyReceiver)
                .unwrap_or(admin.clone()),
            platform_fee_bps: env
                .storage()
                .instance()
                .get(&DataKey::PlatformFeeBps)
                .unwrap_or(0u32),
            platform_fee_receiver: env
                .storage()
                .instance()
                .get(&DataKey::PlatformFeeReceiver)
                .unwrap_or(admin),
        }
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

        let fees = Self::sale_fees(env.clone());
        let price = listing.price;
        let platform_amt = Self::bps_of(price, fees.platform_fee_bps);
        let royalty_amt = Self::bps_of(price, fees.royalty_bps);
        let seller_amt = price
            .checked_sub(platform_amt)
            .and_then(|v| v.checked_sub(royalty_amt))
            .unwrap_or(0);
        if seller_amt < 0 {
            panic!("fees exceed price");
        }

        // If royalty receiver is the seller, fold royalty into one transfer.
        if royalty_amt > 0 && fees.royalty_receiver == listing.seller {
            let combined = seller_amt.checked_add(royalty_amt).unwrap_or(seller_amt);
            if combined > 0 {
                token_client.transfer(&buyer, &listing.seller, &combined);
            }
        } else {
            if seller_amt > 0 {
                token_client.transfer(&buyer, &listing.seller, &seller_amt);
            }
            if royalty_amt > 0 {
                token_client.transfer(&buyer, &fees.royalty_receiver, &royalty_amt);
            }
        }
        if platform_amt > 0 {
            token_client.transfer(&buyer, &fees.platform_fee_receiver, &platform_amt);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::Listing(token_id));
        Self::transfer_internal(&env, &listing.seller, &buyer, token_id);

        env.events().publish(
            (Symbol::new(&env, "sale"), token_id, listing.seller.clone()),
            (seller_amt, royalty_amt, platform_amt),
        );
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

    fn validate_fees(fees: &MarketplaceFeeConfig) {
        if fees.royalty_bps > MAX_ROYALTY_BPS {
            panic!("royalty too high");
        }
        if fees.platform_fee_bps > MAX_PLATFORM_FEE_BPS {
            panic!("platform fee too high");
        }
    }

    fn store_fees(env: &Env, fees: &MarketplaceFeeConfig) {
        env.storage()
            .instance()
            .set(&DataKey::RoyaltyBps, &fees.royalty_bps);
        env.storage()
            .instance()
            .set(&DataKey::RoyaltyReceiver, &fees.royalty_receiver);
        env.storage()
            .instance()
            .set(&DataKey::PlatformFeeBps, &fees.platform_fee_bps);
        env.storage()
            .instance()
            .set(&DataKey::PlatformFeeReceiver, &fees.platform_fee_receiver);
    }

    fn bps_of(amount: i128, bps: u32) -> i128 {
        if amount <= 0 || bps == 0 {
            return 0;
        }
        amount
            .checked_mul(bps as i128)
            .map(|v| v / 10_000)
            .unwrap_or(0)
    }

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
