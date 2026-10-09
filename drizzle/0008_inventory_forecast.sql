CREATE TABLE inventory_policies (
 category_id TEXT PRIMARY KEY REFERENCES categories(id),
 network_id TEXT NOT NULL REFERENCES networks(id),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 target_days INTEGER NOT NULL CHECK(target_days BETWEEN 1 AND 14),
 max_stock INTEGER NOT NULL CHECK(max_stock BETWEEN 1 AND 100000),
 max_replenish INTEGER NOT NULL CHECK(max_replenish BETWEEN 1 AND 10000),
 version INTEGER NOT NULL,
 next_at INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
CREATE INDEX inventory_policy_due ON inventory_policies(enabled,next_at);
CREATE TABLE inventory_evaluations (
 id TEXT PRIMARY KEY,
 network_id TEXT NOT NULL REFERENCES networks(id),
 category_id TEXT NOT NULL REFERENCES categories(id),
 policy_version INTEGER NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('manual','worker')),
 snapshot TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX inventory_eval_history ON inventory_evaluations(category_id,created_at DESC);
CREATE INDEX orders_inventory_forecast ON orders(network_id,category_id,status,paid_at);
