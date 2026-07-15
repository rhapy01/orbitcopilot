#![no_std]
//! Orbit NFT - mintable collectibles with XLM fixed-price listings.

use soroban_sdk::{
 contract, contractimpl, contracttype, token, Address, Env, String, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct TokenMeta {
 pub id: u32,
 pub owner: Address,
 pub name: String,
 pub uri: String,
}

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
 NextId,
 Token(u32),
 Listing(u32),
 OwnerTokens(Address),
 PaymentToken,
}

#[contract]
pub struct OrbitNft;

#[contractimpl]
impl OrbitNft {
 pub fn initialize(env: Env, admin: Address, payment_token: Address) {
 if env.storage().instance().has(&DataKey::Admin) {
 panic!("already initialized");
 }
 admin.require_auth();
 env.storage().instance().set(&DataKey::Admin, &admin);
 env.storage().instance().set(&DataKey::PaymentToken, &payment_token);
 env.storage().instance().set(&DataKey::NextId, &1u32);
 }

 /// Mint a new NFT to `to`. Anyone can mint on testnet for demo UX.
 pub fn mint(env: Env, to: Address, name: String, uri: String) -> u32 {
 to.require_auth();
 let id: u32 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
 let meta = TokenMeta {
 id,
 owner: to.clone(),
 name,
 uri,
 };
 env.storage().persistent().set(&DataKey::Token(id), &meta);
 Self::push_owner_token(&env, &to, id);
 env.storage().instance().set(&DataKey::NextId, &(id + 1));
 id
 }

 pub fn transfer(env: Env, from: Address, to: Address, token_id: u32) {
 from.require_auth();
 let mut meta: TokenMeta = env
 .storage()
 .persistent()
 .get(&DataKey::Token(token_id))
 .expect("token missing");
 if meta.owner != from {
 panic!("not owner");
 }
 // Clear listing on transfer
 env.storage().persistent().remove(&DataKey::Listing(token_id));
 Self::remove_owner_token(&env, &from, token_id);
 meta.owner = to.clone();
 env.storage().persistent().set(&DataKey::Token(token_id), &meta);
 Self::push_owner_token(&env, &to, token_id);
 }

 pub fn list_for_sale(env: Env, seller: Address, token_id: u32, price: i128) {
 seller.require_auth();
 if price <= 0 {
 panic!("price must be positive");
 }
 let meta: TokenMeta = env
 .storage()
 .persistent()
 .get(&DataKey::Token(token_id))
 .expect("token missing");
 if meta.owner != seller {
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
 env.storage().persistent().remove(&DataKey::Listing(token_id));
 }

 /// Buy a listed NFT - pays `price` in payment token (native XLM SAC) to seller.
 pub fn buy(env: Env, buyer: Address, token_id: u32) {
 buyer.require_auth();
 let listing: Listing = env
 .storage()
 .persistent()
 .get(&DataKey::Listing(token_id))
 .expect("not listed");
 let mut meta: TokenMeta = env
 .storage()
 .persistent()
 .get(&DataKey::Token(token_id))
 .expect("token missing");
 if meta.owner != listing.seller {
 panic!("listing stale");
 }

 let payment: Address = env.storage().instance().get(&DataKey::PaymentToken).unwrap();
 let token_client = token::Client::new(&env, &payment);
 token_client.transfer(&buyer, &listing.seller, &listing.price);

 env.storage().persistent().remove(&DataKey::Listing(token_id));
 Self::remove_owner_token(&env, &listing.seller, token_id);
 meta.owner = buyer.clone();
 env.storage().persistent().set(&DataKey::Token(token_id), &meta);
 Self::push_owner_token(&env, &buyer, token_id);
 }

 pub fn owner_of(env: Env, token_id: u32) -> Address {
 let meta: TokenMeta = env
 .storage()
 .persistent()
 .get(&DataKey::Token(token_id))
 .expect("token missing");
 meta.owner
 }

 pub fn token_uri(env: Env, token_id: u32) -> String {
 let meta: TokenMeta = env
 .storage()
 .persistent()
 .get(&DataKey::Token(token_id))
 .expect("token missing");
 meta.uri
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
