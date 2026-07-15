#![no_std]
//! Orbit Supply - fixed-rate XLM yield on USDC / pUSDC / EURC deposits.
//!
//! Rate: **10 XLM per 1,000,000 human units** of stake per 24h period,
//! proportional to each user's stake. The contract holds reward XLM (native SAC)
//! funded via `deposit_reward` (or any transfer of XLM into the contract).

use soroban_sdk::{
 contract, contractimpl, contracttype, token, Address, Env, Vec,
};

const PERIOD_SECS: u64 = 86_400;
/// 10 XLM in stroops (7 decimals).
const REWARD_PER_MILLION_STROOPS: i128 = 100_000_000;
const MILLION: i128 = 1_000_000;

#[contracttype]
#[derive(Clone)]
pub struct TokenConfig {
 pub decimals: u32,
 pub enabled: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct UserPosition {
 pub token: Address,
 pub amount: i128,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
 Admin,
 RewardToken,
 AllowedTokens,
 TokenCfg(Address),
 Stake(Address, Address), // (user, token) -> i128
 LastClaim(Address), // user -> u64
 Total(Address), // token -> i128
}

#[contract]
pub struct OrbitSupply;

#[contractimpl]
impl OrbitSupply {
 pub fn initialize(env: Env, admin: Address, reward_token: Address) {
 if env.storage().instance().has(&DataKey::Admin) {
 panic!("already initialized");
 }
 admin.require_auth();
 env.storage().instance().set(&DataKey::Admin, &admin);
 env.storage()
 .instance()
 .set(&DataKey::RewardToken, &reward_token);
 env.storage()
 .instance()
 .set(&DataKey::AllowedTokens, &Vec::<Address>::new(&env));
 }

 /// Allow a stake asset (USDC / pUSDC / EURC SACs) with its decimal places.
 pub fn allow_token(env: Env, token: Address, decimals: u32) {
 let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
 admin.require_auth();
 if decimals > 18 {
 panic!("decimals too large");
 }
 env.storage().persistent().set(
 &DataKey::TokenCfg(token.clone()),
 &TokenConfig {
 decimals,
 enabled: true,
 },
 );
 let mut list: Vec<Address> = env
 .storage()
 .instance()
 .get(&DataKey::AllowedTokens)
 .unwrap_or(Vec::new(&env));
 let mut found = false;
 for t in list.iter() {
 if t == token {
 found = true;
 break;
 }
 }
 if !found {
 list.push_back(token);
 env.storage()
 .instance()
 .set(&DataKey::AllowedTokens, &list);
 }
 }

 pub fn disable_token(env: Env, token: Address) {
 let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
 admin.require_auth();
 let mut cfg: TokenConfig = env
 .storage()
 .persistent()
 .get(&DataKey::TokenCfg(token.clone()))
 .expect("unknown token");
 cfg.enabled = false;
 env.storage()
 .persistent()
 .set(&DataKey::TokenCfg(token), &cfg);
 }

 /// Pull reward XLM from `from` into the contract treasury.
 pub fn deposit_reward(env: Env, from: Address, amount: i128) {
 from.require_auth();
 if amount <= 0 {
 panic!("amount must be positive");
 }
 let reward: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
 let client = token::Client::new(&env, &reward);
 client.transfer(&from, &env.current_contract_address(), &amount);
 }

 /// Supply (deposit) a supported stable into Orbit Supply.
 pub fn supply(env: Env, user: Address, token: Address, amount: i128) {
 user.require_auth();
 if amount <= 0 {
 panic!("amount must be positive");
 }
 let cfg: TokenConfig = env
 .storage()
 .persistent()
 .get(&DataKey::TokenCfg(token.clone()))
 .expect("token not allowed");
 if !cfg.enabled {
 panic!("token disabled");
 }

 let client = token::Client::new(&env, &token);
 client.transfer(&user, &env.current_contract_address(), &amount);

 let key = DataKey::Stake(user.clone(), token.clone());
 let prev: i128 = env.storage().persistent().get(&key).unwrap_or(0);
 env.storage().persistent().set(&key, &(prev + amount));

 let total_key = DataKey::Total(token.clone());
 let total: i128 = env.storage().persistent().get(&total_key).unwrap_or(0);
 env.storage().persistent().set(&total_key, &(total + amount));

 let claim_key = DataKey::LastClaim(user.clone());
 if !env.storage().persistent().has(&claim_key) {
 env.storage()
 .persistent()
 .set(&claim_key, &env.ledger().timestamp());
 }
 }

 /// Withdraw supplied principal.
 pub fn withdraw(env: Env, user: Address, token: Address, amount: i128) {
 user.require_auth();
 if amount <= 0 {
 panic!("amount must be positive");
 }
 let key = DataKey::Stake(user.clone(), token.clone());
 let prev: i128 = env.storage().persistent().get(&key).unwrap_or(0);
 if amount > prev {
 panic!("insufficient stake");
 }
 env.storage().persistent().set(&key, &(prev - amount));

 let total_key = DataKey::Total(token.clone());
 let total: i128 = env.storage().persistent().get(&total_key).unwrap_or(0);
 env.storage().persistent().set(&total_key, &(total - amount));

 let client = token::Client::new(&env, &token);
 client.transfer(&env.current_contract_address(), &user, &amount);
 }

 /// Claim accrued XLM yield (one or more full 24h periods).
 pub fn claim(env: Env, user: Address) -> i128 {
 user.require_auth();
 let paid = Self::settle_claim(&env, &user);
 if paid <= 0 {
 panic!("nothing to claim yet - wait 24h after supply/last claim");
 }
 paid
 }

 pub fn pending_reward(env: Env, user: Address) -> i128 {
 Self::calc_pending(&env, &user).0
 }

 pub fn get_stake(env: Env, user: Address, token: Address) -> i128 {
 env.storage()
 .persistent()
 .get(&DataKey::Stake(user, token))
 .unwrap_or(0)
 }

 pub fn get_last_claim(env: Env, user: Address) -> u64 {
 env.storage()
 .persistent()
 .get(&DataKey::LastClaim(user))
 .unwrap_or(0)
 }

 pub fn get_total(env: Env, token: Address) -> i128 {
 env.storage()
 .persistent()
 .get(&DataKey::Total(token))
 .unwrap_or(0)
 }

 pub fn reward_balance(env: Env) -> i128 {
 let reward: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
 let client = token::Client::new(&env, &reward);
 client.balance(&env.current_contract_address())
 }

 pub fn get_admin(env: Env) -> Address {
 env.storage().instance().get(&DataKey::Admin).unwrap()
 }

 pub fn get_reward_token(env: Env) -> Address {
 env.storage().instance().get(&DataKey::RewardToken).unwrap()
 }

 pub fn allowed_tokens(env: Env) -> Vec<Address> {
 env.storage()
 .instance()
 .get(&DataKey::AllowedTokens)
 .unwrap_or(Vec::new(&env))
 }

 pub fn stakes_for(env: Env, user: Address) -> Vec<UserPosition> {
 let tokens: Vec<Address> = env
 .storage()
 .instance()
 .get(&DataKey::AllowedTokens)
 .unwrap_or(Vec::new(&env));
 let mut out: Vec<UserPosition> = Vec::new(&env);
 for t in tokens.iter() {
 let amt: i128 = env
 .storage()
 .persistent()
 .get(&DataKey::Stake(user.clone(), t.clone()))
 .unwrap_or(0);
 if amt > 0 {
 out.push_back(UserPosition {
 token: t,
 amount: amt,
 });
 }
 }
 out
 }
}

impl OrbitSupply {
 fn pow10(decimals: u32) -> i128 {
 let mut x: i128 = 1;
 let mut i = 0u32;
 while i < decimals {
 x *= 10;
 i += 1;
 }
 x
 }

 fn daily_for_stake(stake_raw: i128, decimals: u32) -> i128 {
 if stake_raw <= 0 {
 return 0;
 }
 let scale = Self::pow10(decimals);
 stake_raw
 .checked_mul(REWARD_PER_MILLION_STROOPS)
 .expect("overflow")
 / (MILLION * scale)
 }

 fn calc_pending(env: &Env, user: &Address) -> (i128, u64, u64) {
 let last: u64 = env
 .storage()
 .persistent()
 .get(&DataKey::LastClaim(user.clone()))
 .unwrap_or(0);
 if last == 0 {
 return (0, 0, 0);
 }
 let now = env.ledger().timestamp();
 if now < last + PERIOD_SECS {
 return (0, last, 0);
 }
 let periods = (now - last) / PERIOD_SECS;
 if periods == 0 {
 return (0, last, 0);
 }

 let tokens: Vec<Address> = env
 .storage()
 .instance()
 .get(&DataKey::AllowedTokens)
 .unwrap_or(Vec::new(env));

 let mut daily: i128 = 0;
 for t in tokens.iter() {
 let stake: i128 = env
 .storage()
 .persistent()
 .get(&DataKey::Stake(user.clone(), t.clone()))
 .unwrap_or(0);
 if stake <= 0 {
 continue;
 }
 let cfg: TokenConfig = match env.storage().persistent().get(&DataKey::TokenCfg(t)) {
 Some(c) => c,
 None => continue,
 };
 daily = daily
 .checked_add(Self::daily_for_stake(stake, cfg.decimals))
 .expect("overflow");
 }

 let pending = daily
 .checked_mul(periods as i128)
 .expect("overflow");
 (pending, last, periods)
 }

 fn settle_claim(env: &Env, user: &Address) -> i128 {
 let (pending, last, periods) = Self::calc_pending(env, user);
 if pending <= 0 || periods == 0 {
 return 0;
 }
 let reward: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
 let client = token::Client::new(env, &reward);
 let bal = client.balance(&env.current_contract_address());
 if bal < pending {
 panic!("reward treasury empty - fund the contract with XLM");
 }
 client.transfer(&env.current_contract_address(), user, &pending);
 let new_last = last + periods * PERIOD_SECS;
 env.storage()
 .persistent()
 .set(&DataKey::LastClaim(user.clone()), &new_last);
 pending
 }
}
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn initialize_and_allow_token() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(OrbitSupply, ());
        let client = OrbitSupplyClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let reward = Address::generate(&env);
        let usdc = Address::generate(&env);

        client.initialize(&admin, &reward);
        client.allow_token(&usdc, &7u32);

        let allowed = client.allowed_tokens();
        assert_eq!(allowed.len(), 1);
        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_reward_token(), reward);
        assert_eq!(client.reward_balance(), 0);
    }
}