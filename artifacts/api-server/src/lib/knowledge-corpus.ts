/**
 * Curated Orbit knowledge corpus for RAG.
 * Each chunk is citeable: keep sources stable (Orbit KB ids + public docs).
 */

export type KnowledgeChunk = {
 id: string;
 title: string;
 tags: string[];
 /** Short body used for retrieval + answers (plain text). */
 body: string;
 /** Human-readable source label for citations. */
 source: string;
 /** Optional URL for citations. */
 url?: string;
};

export const KNOWLEDGE_CORPUS: KnowledgeChunk[] = [
 {
 id: "blockchain-basics",
 title: "What is a blockchain?",
 tags: ["blockchain", "ledger", "consensus", "crypto", "basics"],
 source: "Orbit Knowledge Base",
 body: `A blockchain is a shared, append-only ledger. Transactions are grouped into blocks, linked cryptographically, and agreed on by a network (consensus). Once confirmed, history is extremely hard to rewrite. Public chains like Bitcoin, Ethereum, and Stellar let anyone verify balances and transfers without a bank. Key ideas: decentralization (many validators), transparency (public history), and finality (when a tx is irreversible for practical purposes).`,
 },
 {
 id: "wallets-keys",
 title: "Wallets, keys, and seed phrases",
 tags: ["wallet", "private key", "seed", "custody", "freighter", "passkey"],
 source: "Orbit Knowledge Base",
 body: `A crypto wallet holds keys, not “coins in an app.” Your public address receives funds; your private key (or seed / passkey) authorizes spending. Never share a seed phrase or private key - anyone with it can drain the wallet. Non-custodial wallets (Freighter, Orbit embedded) mean you sign; Orbit never holds your balances. Custodial (exchange) wallets mean the company holds keys for you - easier UX, counterparty risk.`,
 },
 {
 id: "defi-vs-cefi",
 title: "DeFi vs CeFi",
 tags: ["defi", "cefi", "cex", "exchange", "custody", "comparison"],
 source: "Orbit Knowledge Base",
 body: `CeFi (centralized finance) uses companies - exchanges, brokers, banks - that custody assets and match orders off-chain (Binance, Coinbase, etc.). Fast and familiar, but you trust the firm (hacks, freezes, insolvency). DeFi (decentralized finance) uses smart contracts on a blockchain: swaps, lending, and farms settle on-chain with your wallet. Self-custody and composability, but you take smart-contract, oracle, and UX risk. Orbit Copilot is a DeFi assistant on Stellar Testnet - it proposes on-chain actions you sign.`,
 },
 {
 id: "cryptocurrencies",
 title: "Cryptocurrencies and tokens",
 tags: ["cryptocurrency", "token", "coin", "btc", "eth", "xlm", "stablecoin"],
 source: "Orbit Knowledge Base",
 body: `A cryptocurrency is a native network asset (BTC on Bitcoin, ETH on Ethereum, XLM on Stellar). Tokens are assets issued on top of a chain (USDC, BLND, LP shares). Stablecoins aim to track fiat (usually USD) via reserves or algorithms - useful for trading and lending but not risk-free. Always check which network and which contract/issuer you are using; the same ticker can mean different assets on different chains.`,
 },
 {
 id: "stellar-overview",
 title: "Stellar network overview",
 tags: ["stellar", "xlm", "horizon", "soroban", "testnet", "mainnet"],
 source: "Stellar Docs",
 url: "https://developers.stellar.org/docs",
 body: `Stellar is a blockchain optimized for payments and asset issuance. Native asset is XLM (lumens), used for fees and reserves. Classic operations (payments, trustlines, DEX) go through Horizon. Smart contracts run on Soroban. Orbit Copilot today targets Stellar Testnet - free Friendbot XLM, no real mainnet value. Accounts need a minimum XLM reserve; keep spare XLM for fees and trustlines.`,
 },
 {
 id: "stellar-trustlines",
 title: "Trustlines on Stellar",
 tags: ["trustline", "asset", "issuer", "sac", "usdc", "stellar"],
 source: "Stellar Docs",
 url: "https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts",
 body: `On Stellar Classic, receiving a non-XLM asset usually requires a trustline to that asset’s issuer (or SAC). Without it, inbound payments of that asset fail. Trustlines lock a small XLM reserve. Orbit may prompt “add trustline” before a swap destination. Soroban token balances use contract storage; UX can still feel similar when a wallet must authorize a token.`,
 },
 {
 id: "amm-liquidity",
 title: "AMMs and liquidity provision",
 tags: ["amm", "liquidity", "lp", "pool", "swap", "fees", "steldex", "soroswap", "aquarius"],
 source: "Orbit Knowledge Base",
 body: `An AMM (automated market maker) prices swaps with a pool formula instead of an order book. Liquidity providers (LPs) deposit two assets into a pool and earn a share of trading fees. In return they receive LP tokens representing their share. Providing liquidity is NOT the same as staking a single asset. Risks include impermanent loss (IL): if prices diverge, LP value can underperform simply holding. On Orbit testnet, StelDex / Soroswap / Aquarius expose AMM-style pools.`,
 },
 {
 id: "impermanent-loss",
 title: "Impermanent loss (IL)",
 tags: ["impermanent loss", "il", "lp", "amm", "risk"],
 source: "Orbit Knowledge Base",
 body: `Impermanent loss is the opportunity cost of providing liquidity vs holding the two assets. When relative prices move, the pool rebalances; your mix of tokens changes. Fees can offset IL, but they do not eliminate it. IL is “impermanent” only if prices return - if you withdraw after a large move, the loss is realized. Higher volatility pairs → higher IL risk.`,
 },
 {
 id: "staking-vs-farming",
 title: "Staking vs liquidity vs yield farming",
 tags: ["staking", "farming", "yield", "lp", "rewards", "steldex"],
 source: "Orbit Knowledge Base",
 body: `Three different actions people confuse: (1) Single-asset staking - lock one token to earn rewards. (2) Liquidity provision - deposit TWO assets into a pool, get LP tokens, earn swap fees. (3) Yield farming - stake those LP tokens in a farm for extra reward tokens. Farming usually requires LP first. On StelDex: add liquidity → then stake LP for weeks to earn STELLAR rewards.`,
 },
 {
 id: "lending-borrowing",
 title: "DeFi lending and borrowing",
 tags: ["lending", "borrowing", "collateral", "supply", "blend", "interest", "apy"],
 source: "Blend Docs",
 url: "https://docs.blend.capital",
 body: `Lending protocols let users supply assets to earn interest and borrow against collateral. Utilization drives rates: more borrowing → higher supply APY and borrow APR. Over-borrowing can trigger liquidation (collateral seized to repay debt). On Orbit, Blend's live testnet pool accepts Circle USDC and native XLM (same tokens as your Freighter wallet), plus CETES/TESOURO. Supply uses collateral mode so you can borrow against deposits.`,
 },
 {
 id: "liquidation-health",
 title: "Collateral, health factor, liquidation",
 tags: ["liquidation", "health factor", "ltv", "collateral", "risk", "blend"],
 source: "Orbit Knowledge Base",
 body: `When you borrow, you post collateral. Loan-to-value (LTV) / health factor measures how close you are to liquidation. If collateral value falls or debt rises (interest), health worsens. Past a threshold, liquidators repay debt and take collateral - often at a discount. Keep a buffer; volatile collateral needs more headroom. Always treat leverage and borrowing as high risk.`,
 },
 {
 id: "oracles",
 title: "Price oracles",
 tags: ["oracle", "price", "reflector", "feed", "manipulation"],
 source: "Stellar Docs",
 url: "https://developers.stellar.org/docs/data/oracles/oracle-providers",
 body: `Smart contracts cannot see “the real world” alone - oracles publish prices on-chain. Lending, perps, and liquidations depend on oracle accuracy. Stale or manipulated feeds can cause unfair liquidations or bad trades. Orbit uses Reflector (with Horizon fallbacks) for market snapshots. Treat any price as an estimate until confirmed on-chain.`,
 },
 {
 id: "perps",
 title: "Perpetual futures (perps)",
 tags: ["perp", "perps", "leverage", "long", "short", "margin", "liquidation"],
 source: "Orbit Knowledge Base",
 body: `Perpetual futures let you go long or short with leverage without an expiry date. You post margin; gains/losses track the mark price. Funding rates keep perp price near spot on many venues. High leverage magnifies profit and loss - liquidation can wipe margin quickly. Orbit Perps on testnet support BTC/ETH/XLM open/close with leverage caps; stop-loss and take-profit may be shown in the UI but are not enforced by the contract yet.`,
 },
 {
 id: "prediction-markets",
 title: "Prediction markets",
 tags: ["prediction", "bet", "yes", "no", "odds", "orbit-predict"],
 source: "Orbit Knowledge Base",
 body: `Prediction markets let you stake on yes/no outcomes (elections, price levels, events). Prices imply crowd probabilities. After resolution, winning shares can be claimed. Risks: you can lose the full stake; market liquidity and resolution rules matter. Orbit Predict uses XLM stakes on Soroban testnet markets (e.g. brazil-wins, btc-100k).`,
 },
 {
 id: "stablecoins",
 title: "Stablecoins (USDC, pUSDC, EURC)",
 tags: ["stablecoin", "usdc", "pusdc", "cusdc", "eurc", "circle"],
 source: "Orbit Knowledge Base",
 body: `Stablecoins target a fiat peg. On Orbit/Stellar testnet: USDC and StelDex cUSDC are the same Circle-style USDC (issuer GBBD47… / SAC CBIELT…) - usable on Blend’s live pool, Perps, and classic DEX. pUSDC is a different StelDex-only test token - do not treat pUSDC as USDC. EURC tracks EUR. An older Blend mock pool used a separate USDC (CAQCFV…); Orbit targets the live UI pool that uses Circle USDC.`,
 },
 {
 id: "bridges",
 title: "Bridges and cross-chain transfers",
 tags: ["bridge", "cross-chain", "wormhole", "wrapped", "risk"],
 source: "Orbit Knowledge Base",
 body: `Bridges move value between chains (lock-and-mint, burn-and-release, or liquidity networks). They unlock multi-chain DeFi but concentrate risk: bridge hacks have caused some of the largest crypto losses. Wrapped assets (wETH, wBTC) depend on custody/bridge integrity. Orbit Copilot does not execute bridges today - it can explain them, while execution stays on Stellar testnet protocols.`,
 },
 {
 id: "governance",
 title: "DAO governance",
 tags: ["governance", "dao", "voting", "proposal", "token"],
 source: "Orbit Knowledge Base",
 body: `Many protocols issue governance tokens so holders vote on parameters, upgrades, and treasuries (DAOs). Voting power is often token-weighted. Risks include low turnout, whale capture, and malicious proposals. Orbit does not run governance votes in chat yet; ask for education or check each protocol’s docs (e.g. Blend).`,
 },
 {
 id: "mev-slippage",
 title: "Slippage, MEV, and execution risk",
 tags: ["slippage", "mev", "sandwich", "execution", "swap"],
 source: "Orbit Knowledge Base",
 body: `Slippage is the difference between quoted and executed price when liquidity is thin or size is large. Set slippage tolerance carefully - too tight and txs fail; too loose and you overpay. MEV (maximal extractable value) includes reordering/sandwiching trades on some chains. Stellar’s design differs from Ethereum mempool MEV, but quote staleness and pool depth still matter. Review estimated receive amounts before signing.`,
 },
 {
 id: "risk-checklist",
 title: "DeFi risk checklist",
 tags: ["risk", "security", "scam", "rug", "audit", "checklist"],
 source: "Orbit Knowledge Base",
 body: `Before signing: (1) Confirm network (testnet vs mainnet). (2) Confirm asset codes and destinations. (3) Understand the action (swap ≠ stake ≠ LP ≠ borrow). (4) Size positions you can lose. (5) Prefer known protocols; unaudited contracts are higher risk. (6) Never paste seed phrases into chat or websites. (7) Orbit never asks for private keys. Testnet is for learning - treat mainnet capital with far more caution.`,
 },
 {
 id: "nft-basics",
 title: "NFTs on Orbit",
 tags: ["nft", "mint", "marketplace", "collectible", "beta"],
 source: "Orbit Knowledge Base",
 body: `NFTs are unique on-chain tokens (art, membership, receipts). Orbit NFT (Soroban testnet) supports mint, list for XLM, buy, and transfer. Beta tester NFTs may require feedback eligibility. NFT prices are illiquid and speculative; metadata URIs can change if not immutable. Always verify token id before buying.`,
 },
 {
 id: "cex-basics",
 title: "Centralized exchanges (CEX)",
 tags: ["cex", "binance", "coinbase", "orderbook", "kyc", "cefi"],
 source: "Orbit Knowledge Base",
 body: `A CEX matches buyers and sellers on a centralized order book, usually after KYC. Pros: deep liquidity, fiat on-ramps, familiar UI. Cons: custody risk, withdrawal freezes, geographic restrictions. Moving from CEX to DeFi means withdrawing to your own wallet address on the correct network. Orbit does not trade on CEXes - it helps once funds are in a Stellar wallet.`,
 },
 {
 id: "gas-fees-stellar",
 title: "Fees and reserves on Stellar",
 tags: ["fees", "gas", "reserve", "xlm", "base fee"],
 source: "Stellar Docs",
 url: "https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering",
 body: `Stellar fees are paid in XLM and are typically very low vs Ethereum gas. Accounts must keep a minimum XLM balance (base reserve × account liabilities including trustlines and offers). Soroban adds resource fees for contract CPU/memory. Failed transactions can still consume fees. Keep a small XLM buffer before swaps and LP actions.`,
 },
 {
 id: "smart-contracts",
 title: "Smart contracts",
 tags: ["smart contract", "soroban", "programmable", "composable"],
 source: "Orbit Knowledge Base",
 body: `Smart contracts are programs stored on a blockchain that custody logic and sometimes assets. They enable DeFi without human intermediaries for each trade. Bugs are immutable once deployed (unless upgradeable - which adds admin risk). Soroban is Stellar’s smart contract platform. Orbit Predict, Perps, and NFT markets are Soroban contracts on testnet.`,
 },
 {
 id: "portfolio-idle",
 title: "Idle capital vs earning",
 tags: ["portfolio", "idle", "earning", "rebalance", "coach", "yield"],
 source: "Orbit Knowledge Base",
 body: `Idle capital sits in your wallet earning nothing (beyond price moves). Earning capital is deployed - LP fees, farm rewards, lending supply APY, etc. Orbit’s coach and “what’s earning / rebalance” flows compare idle vs deployed and suggest pasteable chat commands. Deploying always adds protocol risk; leaving funds idle avoids that risk but forgoes yield.`,
 },
 {
 id: "orbit-protocols",
 title: "Protocols Orbit integrates",
 tags: ["orbit", "steldex", "blend", "soroswap", "aquarius", "reflector", "protocols"],
 source: "Orbit Protocol Registry",
 body: `Orbit Copilot backends (Stellar Testnet): Horizon (classic balances/payments/SDEX), Unicorn StelDex (swap, LP, farms, limit orders), Soroswap aggregator, Aquarius AMM quotes, Blend lending, Reflector oracles, Friendbot faucet, Orbit Predict, Orbit Perps, Orbit NFT. Chat is the UI - ask in natural language, then sign with Freighter or Orbit wallet.`,
 },
 {
 id: "spot-vs-derivatives",
 title: "Spot vs derivatives",
 tags: ["spot", "derivatives", "futures", "options", "perps"],
 source: "Orbit Knowledge Base",
 body: `Spot trading buys/sells the asset itself (swap XLM→USDC). Derivatives bet on price without necessarily holding the asset - futures, perps, options. Derivatives add leverage and funding/expiry mechanics; losses can exceed expectations quickly. Prefer spot while learning; use perps only with size you can lose.`,
 },
 {
 id: "apy-apr",
 title: "APY vs APR",
 tags: ["apy", "apr", "yield", "interest", "compound"],
 source: "Orbit Knowledge Base",
 body: `APR is simple annualized rate without compounding. APY includes compounding effects. DeFi “APYs” are often variable, incentivized with reward tokens, and can collapse when incentives end. Compare like-with-like (same asset, same risk). A high advertised APY is not a guarantee - check utilization, emissions, and contract risk.`,
 },
 {
 id: "wrapped-assets",
 title: "Wrapped assets (wETH, wBTC)",
 tags: ["wrapped", "weth", "wbtc", "bridge", "peg"],
 source: "Orbit Knowledge Base",
 body: `Wrapped assets represent value from another chain (wBTC ≈ Bitcoin on a smart-contract chain). They rely on custodians or bridges to mint/burn the wrap. Peg breaks happen if reserves fail. On Blend testnet, wETH/wBTC may appear as reserves - treat them as test representations, not mainnet Bitcoin/Ether.`,
 },
 {
 id: "orderbook-vs-amm",
 title: "Order book vs AMM",
 tags: ["order book", "amm", "cex", "dex", "sdex", "limit order"],
 source: "Orbit Knowledge Base",
 body: `Order books match bids and asks at discrete prices (CEX, Stellar Classic SDEX, some DEXes). AMMs use a bonding curve / pool formula so swaps always have a quote if liquidity exists. Limit orders wait for a price; AMM swaps execute immediately with slippage. StelDex also supports limit orders alongside pool liquidity.`,
 },
 {
 id: "kyc-compliance",
 title: "KYC, AML, and compliance",
 tags: ["kyc", "aml", "compliance", "regulation", "cex"],
 source: "Orbit Knowledge Base",
 body: `Centralized platforms often require KYC (identity verification) for AML rules and fiat rails. Self-custody DeFi wallets typically do not KYC at the protocol layer - but on-ramps, some frontends, and jurisdictions still impose rules. Orbit Copilot does not replace legal advice; know your local regulations before moving real funds.`,
 },
 {
 id: "layer2-scaling",
 title: "L1 vs L2 scaling",
 tags: ["l2", "layer 2", "rollup", "scaling", "ethereum", "fees"],
 source: "Orbit Knowledge Base",
 body: `Layer 1 chains settle consensus and data. Layer 2s (rollups, sidechains) batch activity to cut fees and raise throughput, periodically anchoring to L1. Stellar focuses on fast cheap L1 payments and Soroban contracts rather than Ethereum-style rollups. Bridging to/from L2s reintroduces bridge risk.`,
 },
 {
 id: "consensus-finality",
 title: "Consensus and finality",
 tags: ["consensus", "finality", "validator", "scp", "proof of stake"],
 source: "Orbit Knowledge Base",
 body: `Consensus is how nodes agree on the next ledger. Proof-of-work, proof-of-stake, and Stellar’s SCP are different designs with different energy, latency, and finality properties. “Final” means reversing a tx is economically or practically infeasible. Always wait for sufficient confirmations before treating a deposit as settled - especially across bridges.`,
 },
 {
 id: "tokenomics",
 title: "Tokenomics basics",
 tags: ["tokenomics", "emission", "inflation", "utility", "governance token"],
 source: "Orbit Knowledge Base",
 body: `Tokenomics describes supply, emissions, utility, and value capture. High farm APYs often come from inflationary reward tokens - emissions can dilute holders when incentives end. Ask: who pays the yield, what is unlocked schedule, and does the token have real fee sink / governance demand?`,
 },
 {
 id: "mainnet-vs-testnet",
 title: "Mainnet vs testnet",
 tags: ["mainnet", "testnet", "friendbot", "faucet", "real funds"],
 source: "Orbit Knowledge Base",
 body: `Mainnet moves real value. Testnet uses worthless faucet funds (Friendbot XLM) for development and learning. Orbit Copilot currently executes on Stellar Testnet - practice freely, but never paste mainnet seeds into experimental apps. When mainnet support lands, treat every signature as irreversible money movement.`,
 },
];
