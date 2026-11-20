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
ALTER TABLE analytics.daily_activity ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT '内网';
ALTER TABLE analytics.daily_usage ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT '内网';
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
       app_events, online_ms, online_ms / 3600000.0 AS online_hours, source,
       CASE
         WHEN client_version ~ '^v?0[.][0-9]+[.][0-9]+($|[-+])' THEN '1.0.0 系列以前'
         WHEN client_version ~ '^v?[1-9][0-9]*[.][0-9]+[.][0-9]+($|[-+])' THEN '1.0.0 系列及以上'
         ELSE '版本未知'
       END AS version_group
FROM analytics.daily_activity;

CREATE OR REPLACE VIEW analytics.user_daily_usage AS
SELECT u.day, u.username, u.installation, v.client_version AS last_reported_version,
       u.agent, u.provider, u.model, u.requests, u.input_tokens, u.output_tokens,
       u.cache_read_tokens, u.cache_write_5m_tokens + u.cache_write_1h_tokens AS cache_write_tokens,
       u.input_tokens + u.output_tokens + u.cache_read_tokens +
         u.cache_write_5m_tokens + u.cache_write_1h_tokens AS total_tokens, u.source
FROM analytics.daily_usage u
LEFT JOIN LATERAL (
  SELECT a.client_version FROM analytics.daily_activity a
  WHERE a.installation = u.installation AND a.username IS NOT DISTINCT FROM u.username
    AND a.day <= u.day AND a.client_version IS NOT NULL
  ORDER BY a.day DESC LIMIT 1
) v ON true;

GRANT USAGE ON SCHEMA analytics TO analytics_reader;
GRANT SELECT ON analytics.user_daily_activity, analytics.user_daily_usage, analytics.snapshot TO analytics_reader;

CREATE TABLE IF NOT EXISTS analytics.user_first_seen (
  username text PRIMARY KEY,
  day date NOT NULL
);

CREATE OR REPLACE FUNCTION analytics.remember_first_seen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO analytics.user_first_seen (username, day)
  SELECT username, min(day) FROM analytics.daily_activity WHERE username IS NOT NULL GROUP BY username
  ON CONFLICT (username) DO UPDATE SET day = least(analytics.user_first_seen.day, excluded.day)
  WHERE excluded.day < analytics.user_first_seen.day;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS remember_first_seen ON analytics.snapshot;
CREATE TRIGGER remember_first_seen AFTER INSERT OR UPDATE ON analytics.snapshot
FOR EACH ROW EXECUTE FUNCTION analytics.remember_first_seen();

INSERT INTO analytics.user_first_seen (username, day)
SELECT username, min(day) FROM analytics.daily_activity WHERE username IS NOT NULL GROUP BY username
ON CONFLICT (username) DO UPDATE SET day = least(analytics.user_first_seen.day, excluded.day)
WHERE excluded.day < analytics.user_first_seen.day;

CREATE OR REPLACE VIEW analytics.user_growth AS
WITH additions AS (
  SELECT day, count(*) AS new_users FROM analytics.user_first_seen GROUP BY day
), calendar AS (
  SELECT date_range::date AS day
  FROM generate_series((SELECT min(day)::timestamp FROM analytics.user_first_seen),
                       (SELECT max(day)::timestamp FROM analytics.daily_activity),
                       interval '1 day') date_range
)
SELECT calendar.day, coalesce(additions.new_users, 0)::bigint AS new_users,
       sum(coalesce(additions.new_users, 0)) OVER (ORDER BY calendar.day)::bigint AS total_users
FROM calendar LEFT JOIN additions USING (day);

CREATE OR REPLACE VIEW analytics.installation_versions AS
WITH devices AS (
  SELECT username, installation, max(day) AS day
  FROM analytics.daily_activity
  WHERE username IS NOT NULL
  GROUP BY username, installation
)
SELECT d.day, d.username, d.installation, v.client_version, v.version_seen, v.version_group
FROM devices d
LEFT JOIN LATERAL (
  SELECT a.client_version, a.version_seen, a.version_group
  FROM analytics.user_daily_activity a
  WHERE a.username = d.username AND a.installation = d.installation AND a.version_seen IS NOT NULL
  ORDER BY a.version_seen DESC LIMIT 1
) v ON true;

CREATE OR REPLACE VIEW analytics.user_version_cohort AS
SELECT DISTINCT ON (username) day, username, client_version, version_group
FROM analytics.installation_versions
ORDER BY username, version_seen DESC NULLS LAST, day DESC, installation;

GRANT SELECT ON analytics.user_growth, analytics.installation_versions, analytics.user_version_cohort TO analytics_reader;
