#![no_std]
//! Orbit Predict - on-chain binary prediction markets (Stellar / Soroban).
//! Stakes are held in the contract; winners claim pro-rata from the winning pool.

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Outcome {
    Yes = 0,
    No = 1,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MarketStatus {
    Open = 0,
    Resolved = 1,
    Void = 2,
}

#[contracttype]
#[derive(Clone)]
pub struct Market {
    pub id: u32,
    pub question: String,
    pub slug: String,
    pub status: MarketStatus,
    pub resolved: Option<Outcome>,
    pub yes_pool: i128,
    pub no_pool: i128,
    pub token: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct Position {
    pub market_id: u32,
    pub owner: Address,
    pub outcome: Outcome,
    pub amount: i128,
    pub claimed: bool,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Token,
    MarketCount,
    Market(u32),
    /// (market_id, owner) -> Position (one position per outcome per user; amounts accumulate)
    Position(u32, Address, Outcome),
    UserMarkets(Address),
}

#[contract]
pub struct OrbitPredict;

#[contractimpl]
impl OrbitPredict {
    /// Initialize with admin and stake token (e.g. native XLM SAC).
    pub fn initialize(env: Env, admin: Address, token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::MarketCount, &0u32);
    }

    pub fn create_market(env: Env, question: String, slug: String) -> u32 {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let id: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MarketCount)
            .unwrap_or(0);
        let market = Market {
            id,
            question,
            slug,
            status: MarketStatus::Open,
            resolved: None,
            yes_pool: 0,
            no_pool: 0,
            token: token.clone(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::Market(id), &market);
        env.storage()
            .instance()
            .set(&DataKey::MarketCount, &(id + 1));
        id
    }

    /// Stake `amount` of the market token on Yes or No. Transfers tokens into the contract.
    pub fn place_bet(env: Env, better: Address, market_id: u32, outcome: Outcome, amount: i128) {
        better.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let mut market: Market = env
            .storage()
            .persistent()
            .get(&DataKey::Market(market_id))
            .unwrap_or_else(|| panic!("market not found"));
        if market.status != MarketStatus::Open {
            panic!("market not open");
        }

        let token_client = token::Client::new(&env, &market.token);
        token_client.transfer(&better, &env.current_contract_address(), &amount);

        match outcome {
            Outcome::Yes => market.yes_pool += amount,
            Outcome::No => market.no_pool += amount,
        }
        env.storage()
            .persistent()
            .set(&DataKey::Market(market_id), &market);

        let key = DataKey::Position(market_id, better.clone(), outcome.clone());
        let mut pos: Position = env.storage().persistent().get(&key).unwrap_or(Position {
            market_id,
            owner: better.clone(),
            outcome: outcome.clone(),
            amount: 0,
            claimed: false,
        });
        if pos.claimed {
            panic!("already claimed");
        }
        pos.amount += amount;
        env.storage().persistent().set(&key, &pos);

        let mut user_markets: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::UserMarkets(better.clone()))
            .unwrap_or(Vec::new(&env));
        let mut found = false;
        for m in user_markets.iter() {
            if m == market_id {
                found = true;
                break;
            }
        }
        if !found {
            user_markets.push_back(market_id);
            env.storage()
                .persistent()
                .set(&DataKey::UserMarkets(better), &user_markets);
        }
    }

    pub fn resolve_market(env: Env, market_id: u32, outcome: Outcome) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let mut market: Market = env
            .storage()
            .persistent()
            .get(&DataKey::Market(market_id))
            .unwrap_or_else(|| panic!("market not found"));
        if market.status != MarketStatus::Open {
            panic!("market not open");
        }
        market.status = MarketStatus::Resolved;
        market.resolved = Some(outcome);
        env.storage()
            .persistent()
            .set(&DataKey::Market(market_id), &market);
    }

    /// Claim pro-rata share of the total pool if user bet on the winning outcome.
    pub fn claim(env: Env, claimer: Address, market_id: u32, outcome: Outcome) -> i128 {
        claimer.require_auth();
        let market: Market = env
            .storage()
            .persistent()
            .get(&DataKey::Market(market_id))
            .unwrap_or_else(|| panic!("market not found"));
        if market.status != MarketStatus::Resolved {
            panic!("market not resolved");
        }
        let winner = market.resolved.clone().unwrap();
        if winner != outcome {
            panic!("not winning outcome");
        }

        let key = DataKey::Position(market_id, claimer.clone(), outcome);
        let mut pos: Position = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("no position"));
        if pos.claimed {
            panic!("already claimed");
        }
        if pos.amount <= 0 {
            panic!("empty position");
        }

        let win_pool = match winner {
            Outcome::Yes => market.yes_pool,
            Outcome::No => market.no_pool,
        };
        let total = market.yes_pool + market.no_pool;
        if win_pool <= 0 || total <= 0 {
            panic!("empty pools");
        }
        // Pro-rata: user_amount / win_pool * total
        let payout = pos.amount * total / win_pool;
        pos.claimed = true;
        env.storage().persistent().set(&key, &pos);

        let token_client = token::Client::new(&env, &market.token);
        token_client.transfer(&env.current_contract_address(), &claimer, &payout);
        payout
    }

    pub fn get_market(env: Env, market_id: u32) -> Market {
        env.storage()
            .persistent()
            .get(&DataKey::Market(market_id))
            .unwrap_or_else(|| panic!("market not found"))
    }

    pub fn market_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MarketCount)
            .unwrap_or(0)
    }

    pub fn get_position(env: Env, owner: Address, market_id: u32, outcome: Outcome) -> Position {
        env.storage()
            .persistent()
            .get(&DataKey::Position(market_id, owner, outcome))
            .unwrap_or_else(|| panic!("no position"))
    }

    pub fn user_markets(env: Env, owner: Address) -> Vec<u32> {
        env.storage()
            .persistent()
            .get(&DataKey::UserMarkets(owner))
            .unwrap_or(Vec::new(&env))
    }
}
