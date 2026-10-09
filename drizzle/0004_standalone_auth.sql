CREATE TABLE auth_users (
 id TEXT PRIMARY KEY REFERENCES accounts(id), email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','admin')),
 recovery_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE auth_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON auth_sessions(user_id);
CREATE TABLE auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
