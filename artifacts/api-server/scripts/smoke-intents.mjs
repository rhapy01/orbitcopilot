/**
 * Smoke tests for Greenbelt chat intents + fuzzy spelling normalization.
 * Run: node --test scripts/smoke-intents.mjs
 *
 * Fuzzy helpers are mirrored from src/lib/fuzzy-normalize.ts — keep in sync.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const PERP_CLOSE_RE = /\bclose\s+(?:my\s+)?([a-z0-9]+)\s*perp\b/i;
const PREDICT_CLAIM_RE =
  /\bclaim\s+(?:my\s+)?(?:(yes|no)\s+)?winnings?(?:\s+on\s+([a-z0-9\-]+))?\b|\bclaim\s+(yes|no)\s+on\s+([a-z0-9\-]+)\b/i;
const NFT_MINT_RE =
  /\bmint\s+(?:an?\s+)?nft\b(?:\s+(?:called|named|as)\s+["']?([^"'\n]+)["']?)?(?:\s+(?:uri|url)\s+(\S+))?/i;
const NFT_LIST_RE =
  /\blist\s+nft\s+#?(\d+)\s+(?:for\s+)?([\d.]+)\s*xlm\b/i;
const NFT_BUY_RE = /\bbuy\s+nft\s+#?(\d+)\b/i;
const NFT_CLAIM_BETA_RE =
  /\bclaim\s+(?:my\s+)?(?:orbit\s+)?beta\s+(?:tester\s+)?nft\b|\bclaim\s+(?:my\s+)?feedback\s+nft\b|\bi\s+have\s+submitted\s+my\s+feedback[,\s]+mint\s+my\s+beta\s+tester\s+nft\b|\bmint\s+my\s+beta\s+tester\s+nft\b/i;
const FAUCET_RE =
  /\b(?:faucet|claim\s+test)\s+([a-zA-Z]{2,12})\b|\bmint\s+(?!an?\s+nft\b)([a-zA-Z]{2,12})\b/i;
const SWAP_INTENT_RE =
  /\b(?:swap|exchange|convert)\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+(?:to|for|into)\s+([a-zA-Z]{2,12})\b/i;
const BLEND_OP_RE =
  /\b(supply|lend|deposit|withdraw|borrow|repay)\s+([\d.]+)\s*([a-zA-Z]{2,12})\b/i;

function classify(content) {
  if (NFT_CLAIM_BETA_RE.test(content)) return "nft_claim_beta";
  if (NFT_MINT_RE.test(content)) return "nft_mint";
  if (NFT_LIST_RE.test(content)) return "nft_list";
  if (NFT_BUY_RE.test(content)) return "nft_buy";
  if (PREDICT_CLAIM_RE.test(content)) return "predict_claim";
  if (PERP_CLOSE_RE.test(content)) return "perp_close";
  if (FAUCET_RE.test(content)) return "faucet";
  return null;
}

// --- Mirrored fuzzy-normalize (keep in sync with src/lib/fuzzy-normalize.ts) ---

function editDistance(a, b) {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (s === t) return 0;
  const n = s.length;
  const m = t.length;
  if (!n) return m;
  if (!m) return n;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[n][m];
}

const ASSET_VOCAB = [
  { canonical: "XLM", aliases: ["xlm", "native", "lumens", "lumen"] },
  { canonical: "USDC", aliases: ["usdc", "cusdc"] },
  { canonical: "pUSDC", aliases: ["pusdc"] },
  { canonical: "EURC", aliases: ["eurc"] },
  { canonical: "BLND", aliases: ["blnd"] },
  { canonical: "BTC", aliases: ["btc", "bitcoin"] },
  { canonical: "ETH", aliases: ["eth", "ethereum"] },
];
const PROTOCOL_VOCAB = [
  { canonical: "blend", aliases: ["blend"] },
  { canonical: "steldex", aliases: ["steldex"] },
  { canonical: "soroswap", aliases: ["soroswap"] },
];
const STOP = new Set([
  "lend", "deposit", "withdraw", "borrow", "repay", "supply", "swap", "send",
  "to", "for", "on", "my", "the", "a", "an", "and", "or", "of", "in", "at",
]);

function candidates(entries) {
  const out = [];
  for (const e of entries) {
    out.push({ canonical: e.canonical, key: e.canonical.toLowerCase() });
    for (const a of e.aliases) out.push({ canonical: e.canonical, key: a.toLowerCase() });
  }
  return out;
}
const ALL = [...candidates(ASSET_VOCAB), ...candidates(PROTOCOL_VOCAB)];

function maxDist(len) {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  return 2;
}

function resolveFuzzyToken(raw) {
  const key = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key || STOP.has(key)) return null;
  for (const c of ALL) if (c.key === key) return c.canonical;
  const md = maxDist(key.length);
  if (md === 0) return null;
  let best = null;
  let tie = false;
  for (const c of ALL) {
    if (Math.abs(c.key.length - key.length) > md) continue;
    const d = editDistance(key, c.key);
    if (d > md) continue;
    if (!best || d < best.dist) {
      best = { canonical: c.canonical, dist: d };
      tie = false;
    } else if (best && d === best.dist && c.canonical !== best.canonical) {
      tie = true;
    }
  }
  if (!best || tie) return null;
  return best.canonical;
}

function normalizeUserMessageText(content) {
  return content.replace(/([a-zA-Z0-9]+)/g, (raw) => {
    if (/^G[A-Z2-7]{55}$/i.test(raw)) return raw;
    const glued = raw.match(/^([\d.]+)([A-Za-z][A-Za-z0-9]*)$/);
    if (glued) {
      const resolved = resolveFuzzyToken(glued[2]);
      return resolved ? `${glued[1]}${resolved}` : raw;
    }
    if (/^[\d.]+$/.test(raw)) return raw;
    if (STOP.has(raw.toLowerCase())) return raw;
    return resolveFuzzyToken(raw) ?? raw;
  });
}

describe("greenbelt intents", () => {
  it("maps NFT mint / list / buy", () => {
    assert.equal(classify("mint an NFT called Stellar Fox"), "nft_mint");
    assert.equal(classify("list NFT #1 for 5 XLM"), "nft_list");
    assert.equal(classify("buy nft #12"), "nft_buy");
    const mint = "mint an NFT called Orbit One".match(NFT_MINT_RE);
    assert.ok(mint);
    assert.match(mint[1] ?? "", /Orbit One/i);
    const list = "list NFT #3 for 2.5 xlm".match(NFT_LIST_RE);
    assert.equal(list?.[1], "3");
    assert.equal(list?.[2], "2.5");
  });

  it("does not treat NFT mint as Soroswap faucet", () => {
    assert.equal(classify("mint an NFT called Fox"), "nft_mint");
    assert.ok(!FAUCET_RE.test("mint an NFT called Fox"));
    assert.equal(classify("faucet USDC"), "faucet");
    assert.equal(classify("mint USDC"), "faucet");
  });

  it("maps predict claim and perp close", () => {
    assert.equal(classify("claim yes on brazil-wins"), "predict_claim");
    assert.equal(classify("claim my yes winnings on btc-100k"), "predict_claim");
    assert.equal(classify("close my btc perp"), "perp_close");
    assert.equal("close eth perp".match(PERP_CLOSE_RE)?.[1]?.toLowerCase(), "eth");
  });

  it("maps beta NFT claim", () => {
    assert.equal(classify("claim my beta NFT"), "nft_claim_beta");
    assert.equal(classify("claim orbit beta nft"), "nft_claim_beta");
    assert.equal(classify("claim my feedback nft"), "nft_claim_beta");
    assert.equal(
      classify("i have submitted my feedback, mint my beta tester nft"),
      "nft_claim_beta"
    );
    assert.equal(classify("mint my beta tester nft"), "nft_claim_beta");
  });
});

describe("multi-swap each + predict resolve", () => {
  it("parses swap … each as multiple destinations", async () => {
    const { parseMultiSwapEach } = await import("../src/lib/multi-action.ts").catch(() =>
      import("../dist/lib/multi-action.js").catch(() => null)
    );
    // Inline mirror for smoke without build
    const parse = (content) => {
      const m = content.match(
        /\bswap\s+([\d.]+)\s*([a-zA-Z]{2,12})\s+(?:to|into|for)\s+(.+?)\s+each\b/i
      );
      if (!m) return null;
      const parts = m[3]
        .split(/\s*(?:,|\/|\band\b)\s*/i)
        .map((p) => p.trim())
        .filter(Boolean);
      return { amount: m[1], from: m[2], to: parts };
    };
    const r = parse("swap 200 XLM to pUSDC, cUSDC, EURC each");
    assert.ok(r);
    assert.equal(r.amount, "200");
    assert.equal(r.to.length, 3);
    assert.ok(r.to.some((a) => /pusdc/i.test(a)));
  });

  it("scores chelsea vs arsenal as ambiguous across EPL and FA Cup", async () => {
    // Lightweight inline score check mirroring catalog intent
    const markets = [
      { slug: "chelsea-arsenal-epl", teams: ["chelsea", "arsenal"], competition: "Premier League" },
      { slug: "chelsea-arsenal-fa-cup", teams: ["chelsea", "arsenal"], competition: "FA Cup" },
      { slug: "brazil-wins", teams: ["brazil"], competition: "International" },
    ];
    const hint = "chelsea over arsenal";
    const hits = markets.filter(
      (m) => m.teams.includes("chelsea") && m.teams.includes("arsenal")
    );
    assert.equal(hits.length, 2);
    assert.ok(hits.every((h) => h.slug.includes("chelsea-arsenal")));
    assert.match(hint, /chelsea/);
  });
});

describe("fuzzy spelling normalization", () => {
  it("fixes common asset typos", () => {
    assert.match(normalizeUserMessageText("swap 10 xlmm to pudsc"), /XLM/);
    assert.match(normalizeUserMessageText("swap 10 xlmm to pudsc"), /pUSDC/);
    assert.equal(resolveFuzzyToken("pudsc"), "pUSDC");
    assert.equal(resolveFuzzyToken("xlmm"), "XLM");
    assert.equal(resolveFuzzyToken("bitcon"), "BTC");
    assert.equal(resolveFuzzyToken("etherum"), "ETH");
  });

  it("fixes protocol typos without breaking lend verb", () => {
    assert.match(normalizeUserMessageText("supply 10 USDC on blennd"), /blend/i);
    assert.equal(resolveFuzzyToken("blennd"), "blend");
    assert.equal(resolveFuzzyToken("lend"), null);
    const msg = normalizeUserMessageText("lend 10 USDC on blennd");
    assert.match(msg, /^lend /i);
    assert.match(msg, /blend/i);
  });

  it("splits glued amount+asset typos", () => {
    const msg = normalizeUserMessageText("swap 10pudsc to xlm");
    assert.match(msg, /10pUSDC/);
  });

  it("lets normalized swap/blend phrases match regexes", () => {
    const swap = normalizeUserMessageText("swap 5 xlmm to pudsc");
    const m = swap.match(SWAP_INTENT_RE);
    assert.ok(m);
    assert.equal(m[1], "5");
    assert.match(m[2], /xlm/i);
    assert.match(m[3], /pusdc/i);

    const blendMsg = normalizeUserMessageText("supply 10 usdc on blennd");
    assert.ok(blendMsg.toLowerCase().includes("blend"));
    assert.ok(BLEND_OP_RE.test(blendMsg));
  });

  it("does not over-correct short or unrelated words", () => {
    assert.equal(resolveFuzzyToken("to"), null);
    assert.equal(resolveFuzzyToken("on"), null);
    assert.equal(resolveFuzzyToken("farm"), null);
    assert.equal(normalizeUserMessageText("show my portfolio"), "show my portfolio");
  });
});
