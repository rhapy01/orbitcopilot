#![no_std]
//! Orbit NFT Factory — deploy SEP-50 collections for any creator (chat launchpad).
//!
//! Admin uploads the orbit-nft WASM once and stores its hash. Creators call
//! `create_collection` to deploy + initialize a new collection contract.
//! Marketplace fees: platform cut is locked by the factory; royalty is set per collection.

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, IntoVal, String,
    Symbol, Val, Vec,
};

/// 0.5% Orbit platform fee (basis points).
pub const DEFAULT_PLATFORM_FEE_BPS: u32 = 50;
/// 2.5% default creator royalty.
pub const DEFAULT_ROYALTY_BPS: u32 = 250;
pub const MAX_ROYALTY_BPS: u32 = 1000;
pub const MAX_PLATFORM_FEE_BPS: u32 = 500;

/// Must match orbit-nft `MarketplaceFeeConfig` field layout for cross-contract invoke.
#[contracttype]
#[derive(Clone)]
pub struct MarketplaceFeeConfig {
    pub royalty_bps: u32,
    pub royalty_receiver: Address,
    pub platform_fee_bps: u32,
    pub platform_fee_receiver: Address,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    WasmHash,
    PaymentToken,
    PlatformFeeBps,
    PlatformFeeReceiver,
    Collections,
    CreatorCollections(Address),
}

#[contract]
pub struct OrbitNftFactory;

#[contractimpl]
impl OrbitNftFactory {
    pub fn initialize(
        env: Env,
        admin: Address,
        wasm_hash: BytesN<32>,
        payment_token: Address,
        platform_fee_receiver: Address,
        platform_fee_bps: u32,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        if platform_fee_bps > MAX_PLATFORM_FEE_BPS {
            panic!("platform fee too high");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::WasmHash, &wasm_hash);
        env.storage()
            .instance()
            .set(&DataKey::PaymentToken, &payment_token);
        env.storage()
            .instance()
            .set(&DataKey::PlatformFeeReceiver, &platform_fee_receiver);
        env.storage()
            .instance()
            .set(&DataKey::PlatformFeeBps, &platform_fee_bps);
        env.storage()
            .instance()
            .set(&DataKey::Collections, &Vec::<Address>::new(&env));
    }

    pub fn set_wasm_hash(env: Env, admin: Address, wasm_hash: BytesN<32>) {
        Self::require_admin(&env, &admin);
        env.storage().instance().set(&DataKey::WasmHash, &wasm_hash);
    }

    /// Update Orbit platform fee recipient / bps (factory admin only).
    pub fn set_platform_fee(
        env: Env,
        admin: Address,
        platform_fee_receiver: Address,
        platform_fee_bps: u32,
    ) {
        Self::require_admin(&env, &admin);
        if platform_fee_bps > MAX_PLATFORM_FEE_BPS {
            panic!("platform fee too high");
        }
        env.storage()
            .instance()
            .set(&DataKey::PlatformFeeReceiver, &platform_fee_receiver);
        env.storage()
            .instance()
            .set(&DataKey::PlatformFeeBps, &platform_fee_bps);
    }

    /// Deploy a new SEP-50 Orbit NFT collection owned by `creator`.
    /// `royalty_bps` 0–1000 (default callers should pass 250 = 2.5%).
    pub fn create_collection(
        env: Env,
        creator: Address,
        salt: BytesN<32>,
        name: String,
        symbol: String,
        base_uri: String,
        max_supply: u32,
        open_mint: bool,
        royalty_bps: u32,
    ) -> Address {
        creator.require_auth();
        if royalty_bps > MAX_ROYALTY_BPS {
            panic!("royalty too high");
        }
        let wasm_hash: BytesN<32> = env.storage().instance().get(&DataKey::WasmHash).unwrap();
        let payment: Address = env.storage().instance().get(&DataKey::PaymentToken).unwrap();
        let platform_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(DEFAULT_PLATFORM_FEE_BPS);
        let platform_fee_receiver: Address = env
            .storage()
            .instance()
            .get(&DataKey::PlatformFeeReceiver)
            .unwrap();

        // SDK 22: deploy instance then call initialize (no __constructor).
        #[allow(deprecated)]
        let addr = env
            .deployer()
            .with_current_contract(salt)
            .deploy(wasm_hash);

        let fees = MarketplaceFeeConfig {
            royalty_bps,
            royalty_receiver: creator.clone(),
            platform_fee_bps,
            platform_fee_receiver,
        };

        // initialize(admin, name, symbol, base_uri, payment_token, max_supply, open_mint, fees)
        let args: Vec<Val> = Vec::from_array(
            &env,
            [
                creator.clone().into_val(&env),
                name.into_val(&env),
                symbol.into_val(&env),
                base_uri.into_val(&env),
                payment.into_val(&env),
                max_supply.into_val(&env),
                open_mint.into_val(&env),
                fees.into_val(&env),
            ],
        );
        let _: Val = env.invoke_contract(&addr, &Symbol::new(&env, "initialize"), args);

        let mut all: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Collections)
            .unwrap_or(Vec::new(&env));
        all.push_back(addr.clone());
        env.storage().instance().set(&DataKey::Collections, &all);

        let mut mine: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::CreatorCollections(creator.clone()))
            .unwrap_or(Vec::new(&env));
        mine.push_back(addr.clone());
        env.storage()
            .persistent()
            .set(&DataKey::CreatorCollections(creator.clone()), &mine);

        env.events()
            .publish((symbol_short!("created"), creator), addr.clone());

        addr
    }

    pub fn collections_of(env: Env, creator: Address) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::CreatorCollections(creator))
            .unwrap_or(Vec::new(&env))
    }

    pub fn all_collections(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Collections)
            .unwrap_or(Vec::new(&env))
    }

    pub fn collection_count(env: Env) -> u32 {
        Self::all_collections(env).len()
    }

    pub fn platform_fee_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(DEFAULT_PLATFORM_FEE_BPS)
    }

    pub fn platform_fee_receiver(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::PlatformFeeReceiver)
            .unwrap()
    }

    fn require_admin(env: &Env, admin: &Address) {
        admin.require_auth();
        let stored: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != &stored {
            panic!("not admin");
        }
    }
}
