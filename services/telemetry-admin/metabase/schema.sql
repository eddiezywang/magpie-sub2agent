CREATE SCHEMA IF NOT EXISTS analytics;
CREATE TABLE IF NOT EXISTS analytics.daily_activity (
  day date NOT NULL,
  username text,
  installation varchar(24) NOT NULL,
  last_seen timestamptz NOT NULL,
  version_seen timestamptz,
  client_version varchar(64)
);
ALTER TABLE analytics.daily_activity ADD COLUMN IF NOT EXISTS app_events bigint NOT NULL DEFAULT 0;
ALTER TABLE analytics.daily_activity ADD COLUMN IF NOT EXISTS online_ms bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS analytics.daily_usage (
  day date NOT NULL,
  username text,
  installation varchar(24) NOT NULL,
  agent text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  requests bigint NOT NULL CHECK (requests >= 0),
  input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
  cache_read_tokens bigint NOT NULL CHECK (cache_read_tokens >= 0),
  cache_write_5m_tokens bigint NOT NULL CHECK (cache_write_5m_tokens >= 0),
  cache_write_1h_tokens bigint NOT NULL CHECK (cache_write_1h_tokens >= 0)
);
CREATE TABLE IF NOT EXISTS analytics.snapshot (
  id boolean PRIMARY KEY CHECK (id),
  generated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_version_lookup
  ON analytics.daily_activity (installation, username, day DESC) WHERE client_version IS NOT NULL;

CREATE OR REPLACE VIEW analytics.user_daily_activity AS
SELECT day, username, installation, last_seen, version_seen, client_version,
       app_events, online_ms, online_ms / 3600000.0 AS online_hours
FROM analytics.daily_activity;

CREATE OR REPLACE VIEW analytics.user_daily_usage AS
SELECT u.day, u.username, u.installation, v.client_version AS last_reported_version,
       u.agent, u.provider, u.model, u.requests, u.input_tokens, u.output_tokens,
       u.cache_read_tokens, u.cache_write_5m_tokens + u.cache_write_1h_tokens AS cache_write_tokens,
       u.input_tokens + u.output_tokens + u.cache_read_tokens +
         u.cache_write_5m_tokens + u.cache_write_1h_tokens AS total_tokens
FROM analytics.daily_usage u
LEFT JOIN LATERAL (
  SELECT a.client_version FROM analytics.daily_activity a
  WHERE a.installation = u.installation AND a.username IS NOT DISTINCT FROM u.username
    AND a.day <= u.day AND a.client_version IS NOT NULL
  ORDER BY a.day DESC LIMIT 1
) v ON true;

GRANT USAGE ON SCHEMA analytics TO analytics_reader;
GRANT SELECT ON analytics.user_daily_activity, analytics.user_daily_usage, analytics.snapshot TO analytics_reader;
