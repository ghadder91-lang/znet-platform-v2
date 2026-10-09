CREATE TABLE mikrotik_connections (
 network_id TEXT PRIMARY KEY REFERENCES networks(id),
 endpoint TEXT NOT NULL,
 sealed_credentials TEXT,
 version INTEGER NOT NULL,
 sync_version INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('unconfigured','unverified','syncing','healthy','error')),
 lease_token TEXT,
 lease_until INTEGER,
 last_attempt INTEGER,
 last_success INTEGER,
 last_error TEXT,
 system_json TEXT,
 updated_at INTEGER NOT NULL
);
CREATE TABLE mikrotik_profiles (
 network_id TEXT NOT NULL REFERENCES networks(id),
 remote_id TEXT NOT NULL,
 name TEXT NOT NULL,
 properties TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 PRIMARY KEY(network_id,remote_id),
 UNIQUE(network_id,name)
);
CREATE TABLE mikrotik_bindings (
 category_id TEXT PRIMARY KEY REFERENCES categories(id),
 network_id TEXT NOT NULL REFERENCES networks(id),
 remote_id TEXT NOT NULL,
 profile_name TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 version INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE mikrotik_checks (
 id TEXT PRIMARY KEY,
 network_id TEXT NOT NULL REFERENCES networks(id),
 connection_version INTEGER NOT NULL,
 outcome TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX mikrotik_checks_network ON mikrotik_checks(network_id,created_at DESC);
