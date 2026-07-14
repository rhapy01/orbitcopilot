/**
 * Lightweight RAG over the Orbit knowledge corpus.
 * No vector DB required — BM25-style keyword retrieval with tag boosts.
 */
import { KNOWLEDGE_CORPUS, type KnowledgeChunk } from "./knowledge-corpus";
import { tryConceptAnswer } from "./concept-graph";
import { tryDefiMathAnswer } from "./defi-math";

export type KnowledgeHit = {
  chunk: KnowledgeChunk;
  score: number;
};

export type KnowledgeAnswer = {
  text: string;
  hits: KnowledgeHit[];
};

const EXPLAIN_INTENT_RE =
  /\b(?:what(?:'s|\s+is|\s+are|\s+does|\s+do)|whats|explain|define|meaning\s+of|tell\s+me\s+about|how\s+(?:does|do|is|are|can)|difference\s+between|vs\.?|versus|eli5|why\s+(?:is|are|do|does)|compare)\b/i;

const ACTION_BLOCK_RE =
  /\b(?:swap|send|transfer|pay|stake|unstake|supply|borrow|repay|withdraw|mint\s+(?:an?\s+)?nft|list\s+nft|buy\s+nft|open\s+(?:a\s+)?\d|long\s+\d|short\s+\d|fund\s+my\s+wallet|faucet)\b/i;

/** Live product / wallet queries — must not be answered from the static KB. */
const PRODUCT_QUERY_RE =
  /\b(?:earning|idle|rebalance|portfolio|balance|balances|positions?|activity|my\s+wallet|fund\s+my|friendbot|opportunities)\b/i;

/** True when the user is asking to learn / explain rather than execute. */
export function isExplainIntent(content: string): boolean {
  const t = content.trim();
  if (!t || ACTION_BLOCK_RE.test(t) || PRODUCT_QUERY_RE.test(t)) return false;
  if (EXPLAIN_INTENT_RE.test(t)) return true;
  // Short topic probes: "impermanent loss?", "what about bridges"
  if (/\?$/.test(t) && t.split(/\s+/).length <= 8) return true;
  return false;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s/+.-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/** Simple Porter-ish stemmer lite: strip common suffixes for matching. */
function stem(token: string): string {
  if (token.length <= 4) return token;
  return token
    .replace(/ational$/, "ate")
    .replace(/ing$/, "")
    .replace(/tion$/, "t")
    .replace(/ment$/, "")
    .replace(/ness$/, "")
    .replace(/ies$/, "y")
    .replace(/es$/, "")
    .replace(/s$/, "");
}

type DocIndex = {
  chunk: KnowledgeChunk;
  tokens: string[];
  tf: Map<string, number>;
  tagSet: Set<string>;
};

const DOC_INDEX: DocIndex[] = KNOWLEDGE_CORPUS.map((chunk) => {
  const tokens = tokenize(`${chunk.title} ${chunk.body} ${chunk.tags.join(" ")}`).map(stem);
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return {
    chunk,
    tokens,
    tf,
    tagSet: new Set(chunk.tags.map((t) => stem(t.toLowerCase()))),
  };
});

const N = DOC_INDEX.length;
const DF = new Map<string, number>();
for (const doc of DOC_INDEX) {
  for (const term of doc.tf.keys()) {
    DF.set(term, (DF.get(term) ?? 0) + 1);
  }
}

/** BM25 parameters */
const K1 = 1.4;
const B = 0.75;
const AVG_LEN =
  DOC_INDEX.reduce((s, d) => s + d.tokens.length, 0) / Math.max(1, N);

function bm25Score(queryTerms: string[], doc: DocIndex): number {
  const dl = doc.tokens.length;
  let score = 0;
  const seen = new Set<string>();
  for (const raw of queryTerms) {
    const term = stem(raw);
    if (seen.has(term)) continue;
    seen.add(term);
    const f = doc.tf.get(term) ?? 0;
    if (!f) continue;
    const df = DF.get(term) ?? 0;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    const denom = f + K1 * (1 - B + B * (dl / AVG_LEN));
    score += idf * ((f * (K1 + 1)) / denom);
  }
  // Tag / title boosts
  for (const raw of queryTerms) {
    const term = stem(raw);
    if (doc.tagSet.has(term)) score += 2.2;
    if (stem(doc.chunk.title.toLowerCase()).includes(term)) score += 0.8;
  }
  return score;
}

export function searchKnowledge(
  query: string,
  opts?: { topK?: number; minScore?: number }
): KnowledgeHit[] {
  const topK = opts?.topK ?? 3;
  const minScore = opts?.minScore ?? 1.2;
  const terms = tokenize(query);
  if (!terms.length) return [];

  const scored = DOC_INDEX.map((doc) => ({
    chunk: doc.chunk,
    score: bm25Score(terms, doc),
  }))
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

/** Format retrieved chunks for LLM tool output. */
export function formatKnowledgeForTool(hits: KnowledgeHit[]): string {
  if (!hits.length) {
    return "No knowledge-base hits. Answer from general DeFi knowledge carefully, or say you are unsure. Do not invent Orbit protocol details.";
  }
  return hits
    .map((h, i) => {
      const src = h.chunk.url
        ? `${h.chunk.source} (${h.chunk.url})`
        : h.chunk.source;
      return [
        `[${i + 1}] ${h.chunk.title} (id: ${h.chunk.id}, score: ${h.score.toFixed(2)})`,
        h.chunk.body,
        `Source: ${src}`,
      ].join("\n");
    })
    .join("\n\n");
}

/** Deterministic teach answer with citations (no LLM). */
export function answerFromKnowledge(query: string): KnowledgeAnswer | null {
  if (!isExplainIntent(query) && !/\bvs\.?\b|versus|difference\s+between/i.test(query)) {
    return null;
  }

  const concept = tryConceptAnswer(query);
  if (concept) {
    return { text: concept, hits: [] };
  }

  if (!isExplainIntent(query)) return null;

  const hits = searchKnowledge(query, { topK: 2, minScore: 2.0 });
  if (!hits.length) return null;

  const parts: string[] = [];
  for (const h of hits) {
    parts.push(`**${h.chunk.title}**`, "", h.chunk.body, "");
  }

  const cites = hits.map((h, i) => {
    const label = h.chunk.url
      ? `${h.chunk.title} — ${h.chunk.source}: ${h.chunk.url}`
      : `${h.chunk.title} — ${h.chunk.source}`;
    return `${i + 1}. ${label}`;
  });

  parts.push("── Sources ──", ...cites);
  parts.push(
    "",
    "Orbit executes on Stellar Testnet only. Ask a concrete action (e.g. swap, supply on Blend) when you want to try it."
  );

  return { text: parts.join("\n"), hits };
}

/**
 * Full teach path: DeFi math → concept graph → RAG.
 * Safe to call before LLM; returns null when nothing confident matches.
 */
export function tryTeachAnswer(content: string): string | null {
  const math = tryDefiMathAnswer(content);
  if (math) return math;

  const ans = answerFromKnowledge(content);
  return ans?.text ?? null;
}

/**
 * If this looks like an explain question, return a cited answer.
 * Returns null when retrieval is weak (caller should fall through).
 */
export function tryExplainAnswer(content: string): string | null {
  return tryTeachAnswer(content);
}
