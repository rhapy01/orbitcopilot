#![no_std]
//! Orbit Blend Swap - 1:1 Circle USDC ↔ Blend USDC bridge (testnet).
//!
//! There is no DEX liquidity between Circle USDC and Blend's mock USDC.
//! Admin funds this contract with Blend USDC (from testnet.blend.capital faucet).
//! Users swap Circle USDC in and receive Blend USDC out (same raw amount, 7 decimals).

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    CircleUsdc,
    BlendUsdc,
}

#[contract]
pub struct OrbitBlendSwap;

#[contractimpl]
impl OrbitBlendSwap {
    pub fn initialize(env: Env, admin: Address, circle_usdc: Address, blend_usdc: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::CircleUsdc, &circle_usdc);
        env.storage()
            .instance()
            .set(&DataKey::BlendUsdc, &blend_usdc);
    }

    /// Admin (or anyone) deposits Blend USDC into the bridge treasury.
    pub fn fund_blend(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let blend: Address = env.storage().instance().get(&DataKey::BlendUsdc).unwrap();
        token::Client::new(&env, &blend).transfer(&from, &env.current_contract_address(), &amount);
    }

    /// Admin withdraws Circle USDC collected from swaps (or unused Blend inventory).
    pub fn admin_withdraw(env: Env, token_addr: Address, to: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );
    }

    /// Swap Circle USDC → Blend USDC 1:1 (raw units).
    pub fn swap_to_blend(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let circle: Address = env.storage().instance().get(&DataKey::CircleUsdc).unwrap();
        let blend: Address = env.storage().instance().get(&DataKey::BlendUsdc).unwrap();

        let blend_client = token::Client::new(&env, &blend);
        let available = blend_client.balance(&env.current_contract_address());
        if available < amount {
            panic!("bridge treasury low on Blend USDC - admin must fund_blend");
        }

        token::Client::new(&env, &circle).transfer(&user, &env.current_contract_address(), &amount);
        blend_client.transfer(&env.current_contract_address(), &user, &amount);
    }

    /// Optional reverse: Blend USDC → Circle USDC 1:1 (if treasury holds Circle).
    pub fn swap_to_circle(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let circle: Address = env.storage().instance().get(&DataKey::CircleUsdc).unwrap();
        let blend: Address = env.storage().instance().get(&DataKey::BlendUsdc).unwrap();

        let circle_client = token::Client::new(&env, &circle);
        let available = circle_client.balance(&env.current_contract_address());
        if available < amount {
            panic!("bridge treasury low on Circle USDC");
        }

        token::Client::new(&env, &blend).transfer(&user, &env.current_contract_address(), &amount);
        circle_client.transfer(&env.current_contract_address(), &user, &amount);
    }

    pub fn blend_inventory(env: Env) -> i128 {
        let blend: Address = env.storage().instance().get(&DataKey::BlendUsdc).unwrap();
        token::Client::new(&env, &blend).balance(&env.current_contract_address())
    }

    pub fn circle_inventory(env: Env) -> i128 {
        let circle: Address = env.storage().instance().get(&DataKey::CircleUsdc).unwrap();
        token::Client::new(&env, &circle).balance(&env.current_contract_address())
    }
}
