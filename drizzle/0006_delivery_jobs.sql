ALTER TABLE orders ADD COLUMN checkout_hash TEXT;
ALTER TABLE orders ADD COLUMN provider TEXT;
ALTER TABLE orders ADD COLUMN customer_ref TEXT;
ALTER TABLE orders ADD COLUMN destination_sealed TEXT;
CREATE TABLE delivery_jobs (
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),channel TEXT NOT NULL CHECK(channel IN ('wallet','sms')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','available','delivered','retry','dead')),
 attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,lease_token TEXT,lease_until INTEGER,
 last_error TEXT,acknowledged_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 UNIQUE(order_id,channel)
);
CREATE INDEX idx_delivery_due ON delivery_jobs(status,next_at,lease_until);
CREATE TABLE delivery_attempts (id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES delivery_jobs(id),attempt INTEGER NOT NULL,result TEXT NOT NULL,error_code TEXT,created_at INTEGER NOT NULL);
CREATE TABLE delivery_receipts (job_id TEXT PRIMARY KEY REFERENCES delivery_jobs(id),receipt_id TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL);
CREATE TABLE sandbox_controls (order_id TEXT PRIMARY KEY REFERENCES orders(id),sms_failures INTEGER NOT NULL DEFAULT 0);
CREATE TABLE webhook_receipts (provider TEXT NOT NULL,event_id TEXT NOT NULL,payload_hash TEXT NOT NULL,order_id TEXT NOT NULL REFERENCES orders(id),created_at INTEGER NOT NULL,PRIMARY KEY(provider,event_id));
