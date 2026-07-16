# Blue Belt (Level 5) — checklist

Official Rise In / Stellar Journey to Mastery requirement:

> **Scale your product to 50 users, improve the application based on user feedback, and prepare a professional pitch deck and demo presentation.**

Source: [Stellar Journey to Mastery](https://www.risein.com/programs/stellar-journey-to-mastery-monthly-builder-challenges)

---

## Must-ship (official)

| # | Requirement | How we prove it | Status (live) |
|---|-------------|-----------------|---------------|
| 1 | **~50 users** | `/api/stats` → `events.uniqueWallets` ≥ 50 | **6 / 50** — main gap |
| 2 | **Improve from feedback** | Export feedback + ship 1–2 fixes from comments; note in pitch | Feedback exists (5× 5/5); polish TBD |
| 3 | **Pitch deck** | PDF/slides for reviewers | Not started |
| 4 | **Demo presentation** | Short walkthrough (video or live) of core flows | Not started |

Track users: https://orbitpilot.vercel.app/stats  
Export feedback: https://orbitpilot.vercel.app/api/feedback/summary

---

## Product polish we planned (optional but helps retention)

### 1. Aggregator story
Orbit already drives many protocols from one chat (StelDex, Blend, Soroswap/Aquarius, DeFindex, Meridian, Orbit Supply / Predict / Perps / NFT). Blue Belt should sell that as **Stellar DeFi aggregator UX** — one wallet, one chat, clear next action — not “another single-protocol app.”

Ship as narrative + light UX, not more protocol wiring:
- Surface “what’s earning / where to put X” across live integrations
- Prefer one recommended action when multiple venues exist
- Keep onboarding on a small set of reliable flows while the pitch sells breadth

### 2. Point system
Simple XP for onboarding so ~50 users have a reason to complete flows and return.

Minimum viable:
- Earn points for: connect wallet, first swap, first vault deposit, feedback, beta NFT claim
- Show balance in header or chat
- Optional testnet leaderboard
- Off-chain / DB first (no on-chain points token)

---

## Suggested Blue Belt execution order

1. **Onboarding push** — share demo link + short script (fund → swap → deposit → feedback → claim NFT) until `uniqueWallets` ≥ 50  
2. **Ship 1–2 feedback fixes** — e.g. better intent / typo handling (called out in feedback #1)  
3. **Deploy feedback export** if needed (`/api/feedback/export?format=csv`) for the writeup  
4. **Pitch deck** — problem → chat UX → multi-protocol aggregator → live stats → roadmap (points / mainnet)  
5. **Demo video** (~3–5 min) of the happy path on testnet  

Black Belt (Level 6) is later: Twitter, +30 users, mainnet, audits — not Blue Belt scope.

---

## Feedback export

| Need | URL |
|------|-----|
| Quick summary | `GET /api/feedback/summary` |
| Dashboard JSON | `GET /api/stats` or `/stats` |
| Full JSON | `GET /api/feedback/export` |
| Full CSV | `GET /api/feedback/export?format=csv` |
| Full TXT | `GET /api/feedback/export?format=txt` |

```bash
curl -o orbit-feedback.csv "https://orbitpilot.vercel.app/api/feedback/export?format=csv"
curl -o orbit-feedback.txt "https://orbitpilot.vercel.app/api/feedback/export?format=txt"
```
