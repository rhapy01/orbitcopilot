#![no_std]
//! Orbit Perps - on-chain perpetual positions (Stellar / Soroban).
//! Margin is held in the contract (USDC SAC). Mark price is set by admin/oracle updater.

use soroban_sdk::{
 contract, contractimpl, contracttype, token, Address, Env, String, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Side {
 Long = 0,
 Short = 1,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PositionStatus {
 Open = 0,
 Closed = 1,
 Liquidated = 2,
}

#[contracttype]
#[derive(Clone)]
pub struct Market {
 pub symbol: String,
 pub max_leverage: u32,
 /// Mark price with 1e7 scale (same as stroops-style)
 pub mark_price_e7: i128,
 pub open_interest: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct Position {
 pub id: u32,
 pub owner: Address,
 pub symbol: String,
 pub side: Side,
 pub leverage: u32,
 pub margin: i128,
 pub notional: i128,
 pub entry_price_e7: i128,
 pub stop_loss_e7: i128, // 0 = none
 pub take_profit_e7: i128, // 0 = none
 pub status: PositionStatus,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
 Admin,
 MarginToken,
 PositionCount,
 Market(String),
 Position(u32),
 UserPositions(Address),
}

#[contract]
pub struct OrbitPerps;

#[contractimpl]
impl OrbitPerps {
 pub fn initialize(env: Env, admin: Address, margin_token: Address) {
 if env.storage().instance().has(&DataKey::Admin) {
 panic!("already initialized");
 }
 admin.require_auth();
 env.storage().instance().set(&DataKey::Admin, &admin);
 env.storage()
 .instance()
 .set(&DataKey::MarginToken, &margin_token);
 env.storage().instance().set(&DataKey::PositionCount, &0u32);
 }

 pub fn set_market(env: Env, symbol: String, max_leverage: u32, mark_price_e7: i128) {
 let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
 admin.require_auth();
 let market = Market {
 symbol: symbol.clone(),
 max_leverage,
 mark_price_e7,
 open_interest: 0,
 };
 env.storage()
 .persistent()
 .set(&DataKey::Market(symbol), &market);
 }

 /// Oracle / keeper updates mark price (1e7 scale).
 pub fn set_mark_price(env: Env, symbol: String, mark_price_e7: i128) {
 let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
 admin.require_auth();
 let mut market: Market = env
 .storage()
 .persistent()
 .get(&DataKey::Market(symbol.clone()))
 .unwrap_or_else(|| panic!("market not found"));
 market.mark_price_e7 = mark_price_e7;
 env.storage()
 .persistent()
 .set(&DataKey::Market(symbol), &market);
 }

 /// Open a leveraged position. Margin is transferred into the contract.
 pub fn open_position(
 env: Env,
 trader: Address,
 symbol: String,
 side: Side,
 margin: i128,
 leverage: u32,
 stop_loss_e7: i128,
 take_profit_e7: i128,
 ) -> u32 {
 trader.require_auth();
 if margin <= 0 {
 panic!("margin must be positive");
 }
 if leverage < 1 {
 panic!("leverage");
 }
 let mut market: Market = env
 .storage()
 .persistent()
 .get(&DataKey::Market(symbol.clone()))
 .unwrap_or_else(|| panic!("market not found"));
 if leverage > market.max_leverage {
 panic!("max leverage exceeded");
 }

 let token: Address = env.storage().instance().get(&DataKey::MarginToken).unwrap();
 let token_client = token::Client::new(&env, &token);
 token_client.transfer(&trader, &env.current_contract_address(), &margin);

 let notional = margin * (leverage as i128);
 let entry = market.mark_price_e7;
 // liq ≈ entry ± entry/leverage * 0.9
 let move_e7 = entry / (leverage as i128) * 9 / 10;

 let id: u32 = env.storage().instance().get(&DataKey::PositionCount).unwrap_or(0);
 let pos = Position {
 id,
 owner: trader.clone(),
 symbol: symbol.clone(),
 side: side.clone(),
 leverage,
 margin,
 notional,
 entry_price_e7: entry,
 stop_loss_e7,
 take_profit_e7,
 status: PositionStatus::Open,
 };
 env.storage().persistent().set(&DataKey::Position(id), &pos);
 env.storage().instance().set(&DataKey::PositionCount, &(id + 1));

 market.open_interest += notional;
 env.storage()
 .persistent()
 .set(&DataKey::Market(symbol), &market);

 let mut user_pos: Vec<u32> = env
 .storage()
 .persistent()
 .get(&DataKey::UserPositions(trader.clone()))
 .unwrap_or(Vec::new(&env));
 user_pos.push_back(id);
 env.storage()
 .persistent()
 .set(&DataKey::UserPositions(trader), &user_pos);

 let _ = move_e7; // reserved for on-chain liq checks
 id
 }

 /// Close position at current mark; return margin + PnL (floored at 0).
 pub fn close_position(env: Env, trader: Address, position_id: u32) -> i128 {
 trader.require_auth();
 let mut pos: Position = env
 .storage()
 .persistent()
 .get(&DataKey::Position(position_id))
 .unwrap_or_else(|| panic!("position not found"));
 if pos.owner != trader {
 panic!("not owner");
 }
 if pos.status != PositionStatus::Open {
 panic!("not open");
 }

 let market: Market = env
 .storage()
 .persistent()
 .get(&DataKey::Market(pos.symbol.clone()))
 .unwrap();
 let mark = market.mark_price_e7;
 let dir: i128 = match pos.side {
 Side::Long => 1,
 Side::Short => -1,
 };
 // pnl = (mark - entry) / entry * notional * dir
 let pnl = (mark - pos.entry_price_e7) * pos.notional / pos.entry_price_e7 * dir;
 let mut payout = pos.margin + pnl;
 if payout < 0 {
 payout = 0;
 }

 pos.status = PositionStatus::Closed;
 env.storage()
 .persistent()
 .set(&DataKey::Position(position_id), &pos);

 let token: Address = env.storage().instance().get(&DataKey::MarginToken).unwrap();
 let token_client = token::Client::new(&env, &token);
 if payout > 0 {
 token_client.transfer(&env.current_contract_address(), &trader, &payout);
 }
 payout
 }

 pub fn get_market(env: Env, symbol: String) -> Market {
 env.storage()
 .persistent()
 .get(&DataKey::Market(symbol))
 .unwrap_or_else(|| panic!("market not found"))
 }

 pub fn get_position(env: Env, position_id: u32) -> Position {
 env.storage()
 .persistent()
 .get(&DataKey::Position(position_id))
 .unwrap_or_else(|| panic!("position not found"))
 }

 pub fn user_positions(env: Env, owner: Address) -> Vec<u32> {
 env.storage()
 .persistent()
 .get(&DataKey::UserPositions(owner))
 .unwrap_or(Vec::new(&env))
 }

 pub fn position_count(env: Env) -> u32 {
 env.storage()
 .instance()
 .get(&DataKey::PositionCount)
 .unwrap_or(0)
 }
}
