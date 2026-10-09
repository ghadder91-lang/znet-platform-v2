ALTER TABLE networks ADD COLUMN suspended_at INTEGER;
ALTER TABLE networks ADD COLUMN suspension_reason TEXT;
ALTER TABLE networks ADD COLUMN control_version INTEGER NOT NULL DEFAULT 0;
CREATE INDEX networks_operational ON networks(status,suspended_at);
CREATE TABLE network_control_events (
 id TEXT PRIMARY KEY,
 network_id TEXT NOT NULL REFERENCES networks(id),
 actor_id TEXT NOT NULL REFERENCES accounts(id),
 action TEXT NOT NULL CHECK(action IN ('suspend','resume')),
 reason TEXT NOT NULL,
 version INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(network_id,version)
);
CREATE TRIGGER network_control_no_update BEFORE UPDATE ON network_control_events BEGIN SELECT RAISE(ABORT,'network control history is append-only'); END;
CREATE TRIGGER network_control_no_delete BEFORE DELETE ON network_control_events BEGIN SELECT RAISE(ABORT,'network control history is append-only'); END;
