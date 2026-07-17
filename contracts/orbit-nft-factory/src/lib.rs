#![no_std]
//! Orbit NFT Factory — deploy SEP-50 collections for any creator (chat launchpad).
//!
//! Admin uploads the orbit-nft WASM once and stores its hash. Creators call
//! `create_collection` to deploy + initialize a new collection contract.

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, IntoVal, String,
    Symbol, Val, Vec,
};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    WasmHash,
    PaymentToken,
    Collections,
    CreatorCollections(Address),
}

#[contract]
pub struct OrbitNftFactory;

#[contractimpl]
impl OrbitNftFactory {
    pub fn initialize(env: Env, admin: Address, wasm_hash: BytesN<32>, payment_token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::WasmHash, &wasm_hash);
        env.storage()
            .instance()
            .set(&DataKey::PaymentToken, &payment_token);
        env.storage()
            .instance()
            .set(&DataKey::Collections, &Vec::<Address>::new(&env));
    }

    pub fn set_wasm_hash(env: Env, admin: Address, wasm_hash: BytesN<32>) {
        admin.require_auth();
        let stored: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored {
            panic!("not admin");
        }
        env.storage().instance().set(&DataKey::WasmHash, &wasm_hash);
    }

    /// Deploy a new SEP-50 Orbit NFT collection owned by `creator`.
    pub fn create_collection(
        env: Env,
        creator: Address,
        salt: BytesN<32>,
        name: String,
        symbol: String,
        base_uri: String,
        max_supply: u32,
        open_mint: bool,
    ) -> Address {
        creator.require_auth();
        let wasm_hash: BytesN<32> = env.storage().instance().get(&DataKey::WasmHash).unwrap();
        let payment: Address = env.storage().instance().get(&DataKey::PaymentToken).unwrap();

        // SDK 22: deploy instance then call initialize (no __constructor).
        #[allow(deprecated)]
        let addr = env
            .deployer()
            .with_current_contract(salt)
            .deploy(wasm_hash);

        // initialize(admin, name, symbol, base_uri, payment_token, max_supply, open_mint)
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
}
