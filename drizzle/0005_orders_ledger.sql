CREATE TABLE orders (
 id TEXT PRIMARY KEY,network_id TEXT NOT NULL REFERENCES networks(id),category_id TEXT NOT NULL REFERENCES categories(id),
 request_key TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','payment_exception')),
 voucher_id TEXT UNIQUE REFERENCES vouchers(id),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,paid_at INTEGER,
 UNIQUE(network_id,request_key)
);
CREATE INDEX idx_orders_network_created ON orders(network_id,created_at);
CREATE TABLE payment_events (provider TEXT NOT NULL,reference TEXT NOT NULL,order_id TEXT NOT NULL REFERENCES orders(id),amount INTEGER NOT NULL CHECK(amount>0),outcome TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(provider,reference));
CREATE TABLE journals (id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),provider TEXT NOT NULL,reference TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(provider,reference));
CREATE TABLE ledger_entries (id TEXT PRIMARY KEY,journal_id TEXT NOT NULL REFERENCES journals(id),network_id TEXT NOT NULL REFERENCES networks(id),account TEXT NOT NULL CHECK(account IN ('provider_receivable','network_payable','platform_revenue','payment_suspense')),debit INTEGER NOT NULL CHECK(debit>=0),credit INTEGER NOT NULL CHECK(credit>=0),CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)));
CREATE INDEX idx_ledger_network ON ledger_entries(network_id,account);
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT,'ledger is append-only'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT,'ledger is append-only'); END;
CREATE TABLE operation_events (id TEXT PRIMARY KEY,network_id TEXT NOT NULL REFERENCES networks(id),event TEXT NOT NULL,reference TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE incidents (id TEXT PRIMARY KEY,network_id TEXT NOT NULL REFERENCES networks(id),order_id TEXT NOT NULL REFERENCES orders(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at INTEGER NOT NULL);
