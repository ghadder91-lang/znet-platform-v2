-- Agent subscription accounting foundation; no activation or payment routes enabled.
CREATE TABLE agents (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 credit_limit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_limit_minor>=0),
 version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
 created_at INTEGER NOT NULL
);
CREATE TABLE agent_entries (
 id TEXT PRIMARY KEY,
 agent_id TEXT NOT NULL REFERENCES agents(id),
 kind TEXT NOT NULL CHECK(kind IN ('deposit','adjustment','subscription_debit','repayment')),
 amount_minor INTEGER NOT NULL CHECK(amount_minor<>0),
 reference TEXT NOT NULL,
 request_key TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES accounts(id),
 created_at INTEGER NOT NULL,
 UNIQUE(agent_id,request_key)
);
CREATE INDEX idx_agent_entries_recent ON agent_entries(agent_id,created_at DESC,id DESC);
CREATE VIEW agent_balances AS
 SELECT a.id AS agent_id,
        COALESCE(SUM(e.amount_minor),0) AS balance_minor,
        a.credit_limit_minor,
        COALESCE(SUM(e.amount_minor),0)+a.credit_limit_minor AS spending_power_minor
 FROM agents a LEFT JOIN agent_entries e ON e.agent_id=a.id
 GROUP BY a.id,a.credit_limit_minor;
CREATE TABLE subscription_plans (
 id TEXT PRIMARY KEY,
 code TEXT NOT NULL UNIQUE,
 duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 3660),
 price_minor INTEGER NOT NULL CHECK(price_minor>=0),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 version INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);
CREATE TABLE agent_subscriptions (
 id TEXT PRIMARY KEY,
 agent_id TEXT NOT NULL REFERENCES agents(id),
 network_id TEXT NOT NULL REFERENCES networks(id),
 plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
 request_key TEXT NOT NULL,
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),
 created_at INTEGER NOT NULL,
 UNIQUE(agent_id,request_key)
);
CREATE INDEX idx_agent_subscriptions_network ON agent_subscriptions(network_id,ends_at DESC);
CREATE TABLE agent_audit (
 id TEXT PRIMARY KEY,
 agent_id TEXT NOT NULL REFERENCES agents(id),
 actor_id TEXT NOT NULL REFERENCES accounts(id),
 action TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TRIGGER agent_audit_immutable_update BEFORE UPDATE ON agent_audit BEGIN SELECT RAISE(ABORT,'agent audit append-only'); END;
CREATE TRIGGER agent_audit_immutable_delete BEFORE DELETE ON agent_audit BEGIN SELECT RAISE(ABORT,'agent audit append-only'); END;
CREATE TRIGGER agent_entries_immutable_update BEFORE UPDATE ON agent_entries BEGIN SELECT RAISE(ABORT,'agent entries append-only'); END;
CREATE TRIGGER agent_entries_immutable_delete BEFORE DELETE ON agent_entries BEGIN SELECT RAISE(ABORT,'agent entries append-only'); END;
