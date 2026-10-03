# EGO-100: ЮKassa payment orchestration

Sandbox implementation; independent financial/security review required before merge.
EGO-99 commercial/legal/KYB gates remain open. No production activation is part of
this change. Т-Бизнес remains a contingency, with no executable fallback charge.

## Boundaries and protocol

`packages/payments` owns the narrow provider port and orchestration;
`packages/integrations/src/yookassa.ts` implements the fixed HTTPS ЮKassa endpoint;
`packages/db/src/payment-repository.ts` owns PostgreSQL transactions. API composition
is in `apps/api/src/main.ts`. `packages/domain` gains no framework/SDK dependency.

Official documentation checked 2026-10-03:

- [Interaction/authentication/idempotency](https://yookassa.ru/developers/using-api/interaction-format).
- [HTTP response handling](https://yookassa.ru/developers/using-api/response-handling/http-codes).
- [Notifications](https://yookassa.ru/developers/using-api/webhooks).
- [API reference](https://yookassa.ru/developers/api).

One-stage hosted redirect uses `capture: true`. Only authenticated `succeeded`
with `paid: true` can authorize fulfillment. `waiting_for_capture` is pending,
never captured. Unknown statuses fail closed and retain the raw status. HTTP 5xx,
408/429, malformed/oversized responses and transport failures are UNKNOWN; provider
response bodies and authorization headers never reach logs or API errors.

Money is canonical integer minor-unit strings / PostgreSQL bigint. Decimal RUB
conversion uses BigInt, up to the existing pricing limit of 100000000000 kopecks.
The adapter does not accept an arbitrary API origin and refuses HTTP redirects.
Responses are limited to 64 KiB and 10 seconds. Hosted confirmation URLs must use
the exact `https://yoomoney.ru` origin, no userinfo/fragment, no whitespace or
backslash injection and at most 2048 characters. Paths are provider-controlled,
not an application allowlist: official examples include checkout, API-page and
external-confirmation routes, and legitimate future paths on that same origin
remain accepted. See [official redirect examples](https://yookassa.ru/developers/payment-acceptance/integration-scenarios/manual-integration/basics).

## Persist before network

An owned active Reservation plus an owned `ready` Autograph creates one immutable
Order snapshot: reservation/quote, wall/slot/current target, buyer, autograph,
creator, pricing version, amount/currency and creator share. The Reservation is
the idempotency identity: same reservation + autograph returns the same Order;
changing the autograph conflicts. No client price/currency/return URL is accepted.

One persisted Payment per Order contains the operation UUID and SHA256 of the
exact serialized request, expected shop/mode/amount, fixed return URL and provider
binding. Only after commit does the adapter run. It checks the fingerprint before
sending. Existing attempts keep their original URL and share across config changes.

A PostgreSQL I/O lease serializes provider calls between API instances and the
reconciler without keeping a SQL transaction open during HTTP. A crashed process
leaves a recoverable 60-second lease; expired tokens cannot apply observations.
Known provider IDs use authenticated GET. Without an ID, recovery repeats the
same POST/key/payload within 23 hours of local creation (one hour inside the
provider's documented 24-hour window). There is never a new key or fallback
provider. After that window the attempt requires manual investigation. Reconcile
provider records before any operator remediation; never clear/reuse the attempt.

## Webhook and state machine

`POST /payments/webhooks/yookassa` accepts only a payment ID/event hint. A forged
body cannot mark anything paid. Authenticated GET verifies ID, internal Order
metadata, recipient account/shop, test/live flag, exact amount and currency.
An early notification can recover a not-yet-bound provider ID using verified
Order metadata. Unknown local Orders have no business effects.

No invented HMAC scheme. The route has a 16 KiB body limit. Provider-triggering
create/refresh routes share one per-process 60/minute budget and four-call
concurrency limit. Webhooks have a separate 60/minute budget and four-call capacity;
user requests cannot exhaust either callback allowance. Spoofed callbacks still
consume the bounded callback budget (at most two provider reads per accepted
hint). For multiple replicas, operators must also configure perimeter aggregate
rate limiting. No unbounded per-client memory map is maintained.

Durable receipts deduplicate `(provider, payment ID, event)` identity. A processed
receipt is not used to skip a fresh authoritative observation: an earlier spoof
or stale event must not suppress a later legitimate state. Failed processing is
retried by the provider (non-200) or reconciliation. Raw bodies/card/customer data
are not stored. Browser return query parameters are never payment evidence.

States: `created`, `provider_pending`, `unknown`, `succeeded` (verified transition),
`canceled`, `paid_but_not_fulfilled`, `fulfilled`. Success transitions to fulfillment
or manual review in the same transaction, without a durable half-fulfilled state.
Fulfilled/manual-review states never regress. A contradictory success after a
previous cancellation enters manual review; it does not displace anyone.

## Atomic takeover and database protection

Lock order preserves existing writers: **Wall SHARE → Slot UPDATE → target
Placement → Reservation → Order → Payment → Autograph/evidence → User**.
Cancellation/lazy expiry already lock Slot before Reservation, so the payment
path must not invert that order. PostgreSQL time is sampled after eligibility
lock waits. Network calls never occur under these locks.

The transaction validates the binding again, active/unexpired Reservation,
unchanged target and pinned pricing, wall lifecycle/time, visibility cooldown,
active buyer, and ready owned autograph plus approval/moderation/cleaned evidence.
It closes the old Placement with `end_reason=takeover`, inserts the new Placement,
consumes Reservation, fulfills Order/Payment and inserts exactly one earning.
Existing Placement rows are the history; the new `started_at` establishes the
existing pricing cooldown. All effects commit or roll back together.

Database uniqueness protects one active placement/Slot, one Order/Reservation,
one Payment/Order, one provider ID, one operation key and one earning per
Order/Payment/Placement. Snapshot/binding triggers prevent rewriting immutable
financial inputs. Deferred aggregate triggers require matching verified payment,
consumed reservation, placement and earning before a fulfilled Order can commit.
Earnings cannot be updated/deleted. Truncation used by isolated fixtures is not a
runtime operation.

The creator earning primitive stores gross, configured share in basis points,
`floor(gross * share / 10000)` in minor units and all source links. **No commercial
share is invented or defaulted.** The operator must supply an approved share;
fixtures use synthetic 5000 bps. This is not an available balance, payout promise,
or complete ledger. EGO-103 owns balances, holds and compensating adjustments.

## Late success and reconciliation

Expired/cancelled Reservation, changed Slot, ended/paused Wall or invalid autograph
means `paid_but_not_fulfilled` + reason, zero placement/earning effects. This release
uses explicit manual compensation review, not a fabricated successful refund.
No automatic refund, partial refund, dispute, receipt or payout subsystem is added.
EGO-101/102/103 retain those responsibilities.

`pnpm payments:reconcile` (built API image: `node dist/payments/reconcile.js`) polls
a bounded batch using the same provider verification and fulfillment service.
Schedule it at least once per minute with the same API config/DB and monitor exit
status. It is executable but **not automatically scheduled/deployed by this PR**.
Retry failures use bounded exponential backoff; terminal observations are audited
daily. A deterministic authenticated create HTTP 4xx (excluding 408/429) records
`unknown` + `PROVIDER_REJECTED` as an audit-visible, non-retry/manual-review attempt.
When no provider ID is bound, it is excluded from automatic reconciliation and
never recreated, including after the create-retry deadline. Anomalies still emit
its reason for operator attention. A rejection while GETting an already-bound
payment remains reconcilable. Transport ambiguity, 408/429 and 5xx retain the
same-key recovery path; no rejection authorizes a takeover. Structured
`payment_attention` signals contain only Order ID and a fixed
reason code. Manual-review/unknown/mismatch/contradictory terminal/repeated failure
states remain queryable. EGO-111 owns alert delivery and durable incident routing.

## HTTP and return page

- `POST /payments/orders`: authenticated strict `{ reservationId, autographId }`.
- `GET /payments/orders/:id`: owner-only local status; no provider credentials/keys.
- `POST /payments/orders/:id/refresh`: owner-only authenticated provider refetch.
- `POST /payments/webhooks/yookassa`: bounded provider observation hint.
- `/payments/return?orderId=…`: backend status UI. Configured base return URL gets
  only the server-generated Order ID appended. Refresh never trusts `paid/status`
  from navigation. A full checkout selector/countdown is outside this backend PR;
  clients use the create API's safe confirmation URL.

Cookie mutation origin checks and current active-session validation remain intact.
There is no mark-paid route. IDOR attempts return not-found; public Wall/history
responses do not gain payment/financial/private-media fields.

## Configuration and operator gates

No payment variables means checkout is disabled (no payment routes). Any partial
payment config fails startup. Explicitly set all server-only fields when enabling:

- `PAYMENT_PROVIDER=yookassa`;
- `PAYMENT_MODE=sandbox`;
- `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` from the authorized secret manager;
- `PAYMENT_RETURN_URL` fixed URL on `WEB_ORIGIN`, normally `/payments/return`;
- `PAYMENT_CREATOR_SHARE_BPS` approved integer 0–10000, no default.

Local/test/development/staging reject live. Sandbox requires a test credential
prefix and independently verifies provider `test` and merchant binding. Live
requires production plus separate `PAYMENT_LIVE_ACTIVATION=approved`; setting this
is an operator authorization, not evidence of legal/fiscal readiness. Do not enable
it until EGO-99/101/102/103 and production review gates are satisfied. This PR changes
no production config, Lockbox payload, IAM or cloud resources.

Safe sandbox secret references supplied by owner: `yookassa-test-shop-id` and
`yookassa-test-secret-key`. Values never belong in Git, PR, Linear or logs. Set
HTTP notifications in the sandbox merchant account only after a reviewed endpoint
is deployed; a local fixture route does not constitute a real provider callback.

## Validation evidence (2026-10-03)

- Unit: 348 PASS; integration: 189 PASS, including 49 payment tests against real
  isolated PostgreSQL. Two application pools, 50 concurrent webhook/reconciliation
  calls, 20 concurrent creates, cancellation race, real lock-wait expiry, expired
  lease recovery, transactional failure/retry and immutable DB guards are covered.
- Browser E2E: 4 PASS (existing core flows plus two return-page contract fixtures).
  The browser payment cases do not claim genuine provider payment completion.
- Format, lint, typecheck, build, built API smoke: PASS.
- Drizzle generate: no residual schema changes. Migration applies to a clean DB
  and populated pre-0014 schema, preserving active placement/history; 25 public
  tables after upgrade. `db:migrate` and the full integration runner pass.
- Historical pre-review ЮKassa test-shop evidence: authentication, create a pending
  1.00 RUB test payment, allowed hosted confirmation URL, authenticated getPayment
  and exact idempotent retry (same provider payment) PASS. Provider `test=true` and merchant binding
  verified in memory. No real card/payment, completed sandbox payment, real webhook
  callback or refund was exercised. Those remain rollout gates.
- Production/live credentials, production resources, IAM and deployments untouched.

Security rotation result: **BLOCKED**. Rotation requires the merchant operator
flow and owner SMS confirmation; it has not been performed in this environment.
The old key is not used for any new genuine sandbox smoke. Operator must delete/revoke the exposed sandbox key,
issue a replacement, store it only as `textValue` under `YOOKASSA_SECRET_KEY`, and
store the shop ID as a value under `YOOKASSA_SHOP_ID`. Ordinary reissue leaves the
old key usable for 48 hours, so explicit deletion or verified expiry is necessary.
Verify old-key authentication is rejected without creating a payment, then rerun
safe credential scans. See [provider key management](https://yookassa.ru/docs/support/merchant/payments/implement/keys).

Operator action before runtime enablement: during sandbox preflight the supplied
credentials were found in Lockbox entry **names**, not `textValue`. YC CLI debug
logs include entry names; the follow-up rescan found one residual local YC
history file containing credential material and redacted it. Repository/current
committed-tree scans found zero matches, and rescanned local logs/history/cache
contain zero remaining matches. Lockbox REST audit read payloads in memory; no
new CLI payload logging or genuine provider payment request was performed. Rotate
the sandbox secret and place the replacement in the
value field under a nonsensitive entry name. This implementation deliberately does
not support retrieving runtime credentials from entry names. Lockbox contents were
not changed by this PR. Approve a creator share and deploy/configure the sandbox
callback and reconciliation schedule before a complete hosted-payment smoke.
