# Z NET — Agent subscriptions and activation specification (draft)

Status: DESIGN ONLY. No agent billing, issuance, or activation endpoints are enabled by this document.

## Scope
Agents sell Z NET application subscriptions only, not Wi-Fi cards. Admin can create/suspend agents, set a credit limit, approve subscription products, and inspect a tamper-evident audit trail. Agents can view their own balances and issue/renew subscriptions for network owners.

## Proposed data model (PostgreSQL target; adapt for SQLite pilot)
- agents(id, account_id UNIQUE, status, credit_limit_minor, created_at, version)
- subscription_plans(id, code UNIQUE, duration_days, price_minor, enabled, version)
- agent_ledger(id, agent_id, activation_id, kind, amount_minor, created_at, request_key, actor_id)
- subscriptions(id, network_id, plan_id, starts_at, ends_at, status, created_at)
- activations(id, agent_id, network_id, plan_id, request_key, subscription_id, created_at, status)
- agent_audit(id, agent_id, actor_id, action, detail_json, created_at)

Constraints:
1. Monetary values are integer minor units, never floating point.
2. UNIQUE(agent_id, request_key) for activation idempotency.
3. UNIQUE(agent_id, activation_id, kind) for ledger idempotency where applicable.
4. No negative available credit beyond the explicitly authorized credit limit.
5. All writes that debit agent credit and issue/extend subscriptions occur in ONE transaction.
6. Network ownership, agent status, plan status, and admin privileges must be checked server-side.
7. Subscription renewals define explicit stacking rules and use an authoritative server clock.
8. Never store activation secrets or voucher credentials in logs or URLs.
9. Suspend agent prevents new activations but does not erase historical records.
10. No agent may change their own credit limit, prices, or role.

## Proposed API (not implemented)
- GET /api/agents/me: agent-only balance, own ledger and activations.
- POST /api/agents/activate: agent-only idempotent activation with networkId, planId, requestKey.
- GET /api/admin/agents: admin-only listing and search.
- POST /api/admin/agents: admin-only create/suspend/credit adjustments; mandatory reason and expectedVersion.
- GET /api/subscriptions/network: scoped subscription state for owner/admin.

## Required tests before enabling
- Cross-agent and cross-owner isolation.
- Concurrent duplicate requests and idempotent replay.
- Insufficient credit, suspended agent, disabled plan.
- Concurrent renewal and expiry boundary conditions.
- Balanced ledger, rollback on failure and durable audit.
- Role spoofing, CSRF/origin and input-size checks.
- Backup/restore of active subscriptions and ledger.
- Reconciliation with existing activation service and mobile app identity.

## Open decisions requiring owner confirmation
- Agent prepayment vs credit vs both.
- Whether subscription starts at payment/activation or after trial expiry.
- Whether multiple devices per subscription are allowed.
- Existing activation server protocol and licensing device identifier.
- Final subscription prices and commission/discount policy.

## Delivery
Implement in a separate PR with migrations, tests, documented rollback and no production deployment. Do not invent external activation APIs.
