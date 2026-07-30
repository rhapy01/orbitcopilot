# Orbit MCP — add one link (PayBox-style)

## Connector URL

```
https://orbitpilot.vercel.app/mcp
```

Paste that into Claude or ChatGPT (OAuth). Sign in to Orbit → Allow.

## How a swap (or any action) finishes

1. You ask in ChatGPT/Claude: “swap 10 XLM to USDC” (or vault, predict, NFT, bridge, …)
2. MCP tool `orbit_do` uses the **same engines as Orbit chat** and returns a pending action
3. An **in-chat Orbit confirm panel** appears (MCP Apps) — unlock/confirm there without leaving the host
4. Your Orbit wallet signs & submits on Stellar Testnet inside that panel
5. AI can poll `get_action_status` for the tx hash

If a host has no MCP Apps UI, `approvalUrl` (`/approve/:id`) is a rare fallback.

The AI never holds keys. Signing only happens in your browser on the Orbit-origin embed.

## Activities covered

Anything Orbit chat can prepare: classic send/swap, Soroswap, StelDex, Blend, vaults, predict, perps, NFT, tokens, CCTP, Aquarius, trustlines, etc. — via `orbit_do`.
