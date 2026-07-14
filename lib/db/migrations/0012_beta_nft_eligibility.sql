-- Beta feedback NFT whitelist (one claimable Orbit Beta Tester NFT per wallet)
-- Apply: psql "$DATABASE_URL" -f lib/db/migrations/0012_beta_nft_eligibility.sql

CREATE TABLE IF NOT EXISTS beta_nft_eligibility (
  wallet_public_key text PRIMARY KEY,
  feedback_id integer,
  whitelisted_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token_id integer,
  claim_tx_hash text
);

CREATE INDEX IF NOT EXISTS beta_nft_eligibility_claimed_idx
  ON beta_nft_eligibility (claimed_at)
  WHERE claimed_at IS NOT NULL;
