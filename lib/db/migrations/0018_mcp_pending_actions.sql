-- MCP pending actions: prepare in AI host, approve/sign in Orbit browser
CREATE TABLE IF NOT EXISTS mcp_pending_actions (
  id serial PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  user_id integer,
  wallet_public_key text NOT NULL,
  action jsonb NOT NULL,
  summary text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  tx_hash text,
  error text,
  intent_text text,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_pending_actions_user_idx ON mcp_pending_actions (user_id);
CREATE INDEX IF NOT EXISTS mcp_pending_actions_wallet_idx ON mcp_pending_actions (wallet_public_key);
CREATE INDEX IF NOT EXISTS mcp_pending_actions_status_idx ON mcp_pending_actions (status);
