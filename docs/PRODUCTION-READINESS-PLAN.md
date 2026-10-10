# Z NET — Production Readiness Work Plan

Status: audit/planning only. No production deployment or merges authorized.
Base repository: ghadder91-lang/znet-platform-v2
Working branch: codex/znet-production-readiness

## Verified by source inspection
- Next.js 16 / React 19 / Node >=24 / pnpm 11.25.0.
- SQLite via node:sqlite, migration scripts in drizzle/.
- Session-based authentication; scrypt password hashing.
- Internal commerce engine with deduplication, voucher allocation and balanced journal checks.
- Dockerfile and compose.yaml define web app, delivery worker, forecast worker and Caddy proxy.
- Existing tests under tests/. README/READINESS.md claims 53 tests pass; not independently executed during this audit.
- No verified live bank/wallet settlement, SMS delivery, or MikroTik write operations.

## Phase 0 — Reproduce
1. Pin Node 24 and pnpm 11.25.0 in a clean isolated environment.
2. Run pnpm install --frozen-lockfile, pnpm test, pnpm build, pnpm exec tsc --noEmit.
3. Build and run Docker Compose in staging; check /api/health and logs.
4. Record exact commands, exit codes, logs and environment (without secrets).
5. Inspect GitHub Actions and secret scanning before enabling any deployment.

## Phase 1 — Security and correctness
- Test authorization on every API route (owner/admin/other owner).
- Review CSRF/origin checks for all state-changing endpoints, not just auth.
- Test transaction idempotency, concurrency, recovery, ledger invariants and voucher secrecy.
- Review encrypted secret management, rotation, backups, restore and audit logging.
- Never include real wallet keys, customer numbers or live voucher credentials in fixtures.

## Phase 2 — Scale and architecture
- Benchmark SQLite under expected write concurrency; document thresholds.
- Design PostgreSQL migration with reversible staging rehearsal, integrity checks and downtime plan.
- Establish metrics, alerts, log redaction, offsite encrypted backups and restore drills.
- Validate delivery queue retry, lease ownership and duplicate suppression.

## Phase 3 — Product completion
- Admin operations, agent subscription/licensing workflows, inventory and card delivery.
- MikroTik writes only behind explicit approvals, allowlists and rollback-safe testing.
- Bank/wallet adapters only after official API specifications and credentials are supplied through secure secret storage.
- SMS provider integration with delivery acknowledgements and reconciliation.

## Acceptance gates
- Automated tests, build and container smoke tests pass on clean environment.
- Role and network isolation verified; payment/ledger invariant tests pass.
- Backup restore verified in separate staging environment.
- Real provider end-to-end sandbox certification and manual mobile QA completed.
- Explicit owner approval required before merging or production deployment.

## Agent workstreams (separate PRs)
A. CI reproducibility and smoke tests.
B. API auth/security tests.
C. DB migration feasibility and load test harness.
D. Admin + agents/licensing design and tests.
E. Provider/MikroTik integration contracts and sandbox tests.

All PRs must include tests, migration notes, risk assessment and rollback steps.
