# Standalone pilot readiness

Read README.md (Arabic) for installation, scope, limitations and verification.

Implemented: independent email/password identity (unverified email), scrypt hashes, HttpOnly/SameSite cookies, production Secure cookies with HTTPS, one-use recovery code rotation and session revocation, owner/admin roles, persistent single-node SQLite with automatic migrations, prior inventory features, request limits, backup/integrity-checked restore with encryption-key fingerprint checks.

Commerce is an internal engine, not live payments: atomic payment deduplication, card allocation, double-entry entries, suspended unmatched/duplicate/late payments and incident records. A signed sandbox callback and partner checkout API use a separate test database; production payment endpoints remain disabled. SMS delivery is simulated only; real SMS, withdrawal, automatic settlement reconciliation and provider integration remain disabled. Manual statement comparison is implemented (see 1.2).

Validation (current 1.5): 53 Node tests, Next production build/typecheck, HTTP server smoke test, actual backup/restore test. Docker runtime and clean dependency download were not available for verification. Browser visual/mobile QA and production load/security review remain required.

Do not rely on incoming oai-authenticated-user headers. Standalone APIs derive identity from server-side sessions. First registration is never admin. Original Site data and vault key are not included. New databases use a new key; old encrypted data requires its original key plus verified account mapping.

One app process / local SQLite volume only. No NFS/shared DB file or multi-replica deployment. Backups must be exported off-host, with key escrow kept separately. Existing Site remains unchanged.

Version 1.1 adds sandbox partner authentication, HMAC callbacks, independent wallet/SMS delivery jobs, five-attempt backoff, lease recovery, wallet read/ack, and sandbox-only background worker. See docs/PARTNER-API.md.

## 1.2 reconciliation
Owner-scoped fixed-schema CSV import, persisted snapshots and rows, partial/full coverage, five discrepancy categories, deduplication, version-checked review notes. Never posts financial adjustments. No automatic provider download, settlement matching, snapshot refresh, or reconciliation sandbox UI. See docs/RECONCILIATION.md for timing, range and schema limits. 33 automated tests plus production build and HTTP smoke; no Docker runtime verification.

## 1.3 inventory forecast
Completed Yemen-day trailing averages, data sufficiency gates, available-only stock, paid/allocated order counts, capped replenishment suggestions, per-category versioned policies and audit. Owner-scoped read/write/evaluate API. Separate advisory worker, bounded batches, 15-minute cooldown, transactional duplicate suppression and 100 snapshots per category. No live generation, stock mutations, external notifications or learned prediction model. Assumes sales represent demand; stockout/outage censoring is not corrected. Forty automated tests include two worker processes sharing one database, plus build and HTTP checks. Browser visual test could not run (Chromium absent); Docker remains unverified.


## 1.4 MikroTik read-only connection
Operator-approved per-network HTTPS targets; encrypted credentials with versioned AAD; fixed GET endpoints; explicit TLS verification; redirect refusal; bounded responses and absolute deadlines. Owner setup wizard, resource snapshot, HotSpot profile cache, per-category versioned mappings and unlink/disconnect. Drift detection covers selected properties only; manual checks age out after 15 minutes. Serialized sync with cooldown and stale-result rejection. Default disabled. Tested via fixture replies and an actual local HTTPS server, never a physical RouterOS device. No generation/write access or continuous router polling. Browser and Docker runtime QA remain outstanding. See docs/MIKROTIK.md.


## 1.5 admin command center
Database-enforced admin role, global operational counts, parameterized search/filters/pagination, network drilldown with scoped ledger summaries and masked order references (no card secrets). Separate operational suspension flag and versioned, append-only control history. Suspension blocks new checkout and card allocation for subsequent verified payments; funds remain balanced in suspense. It pauses scheduled forecast work. Resumption does not approve a pending network, replay suspended payments, or modify router connectivity. Owner editing/inventory access remains available. 53 tests include owner spoofing, concurrent-version conflicts, suspension and payment replay, role revocation, worker pause, and HTTP checks with separate owner/admin sessions. No user-facing balance mutation or incident auto-close is added.
