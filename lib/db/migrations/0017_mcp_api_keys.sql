-- Remote MCP connector API keys (read | prepare scopes only — never sign).
CREATE TABLE IF NOT EXISTS mcp_api_keys (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  token_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  label text NOT NULL DEFAULT 'MCP connector',
  scopes jsonb NOT NULL DEFAULT '["read"]'::jsonb,
  bind_public_key text,
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_api_keys_user_idx ON mcp_api_keys (user_id);
CREATE INDEX IF NOT EXISTS mcp_api_keys_active_idx ON mcp_api_keys (token_hash)
  WHERE revoked_at IS NULL;
