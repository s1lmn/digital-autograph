# Proposed acquiring adapter boundary (EGO-99)

Status: **Design input for EGO-100, not a shipped runtime contract.** No acquiring
adapter, payment route, DB schema, SDK or config consumer is introduced here.
The accepted choice is **ЮKassa primary / Т-Бизнес fallback**, recorded in the
[decision record](../product/payment-provider-decision.md).

## Placement in the existing architecture

Use a small typed port owned by the future payment service and provider-specific
adapters in `packages/integrations`. Inject an adapter at `apps/api/src/main.ts`,
as existing auth/private S3 adapters are composed. Keep provider SDK/HTTP types
out of `packages/domain`, public contracts and PostgreSQL business transactions.
Do not build a generic payment framework, capability registry or automatic
provider failover. Define executable types alongside their first consumer in
EGO-100 for ЮKassa, with actual protocol validation using the available sandbox.
Т-Бизнес remains a documented contingency; no fallback adapter or runtime
failover is introduced. Sandbox shopId/secretKey are stored externally in Yandex
Lockbox by the owner; this design contains no values or invented secret name.

Proposed four operations (names are design sketches):

| Operation       | Required input                                                                                                                                                                                            | Safe output / responsibility                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createPayment` | Persisted internal Order reference; backend quote amount as canonical minor-unit integer string + RUB; durable operation key; approved return URL; provider-specific approved receipt input when required | Provider payment ID, hosted checkout URL, observation. No placement or Order fulfillment                                                                              |
| `getPayment`    | Provider payment ID bound to configured provider + merchant + mode                                                                                                                                        | Authenticated observation: provider/merchant/mode, payment ID, merchant Order correlation, actual amount/currency, raw status, normalized state and verification time |
| `refundPayment` | Persisted refund operation ID/key, bound payment ID, backend-authorized amount/currency, approved receipt correction when required                                                                        | Refund reference and pending/settled/failed/unknown observation. Success of request is not completed refund                                                           |
| `verifyWebhook` | Bounded raw body, headers, trusted transport metadata                                                                                                                                                     | Async verified observation or rejection. Provider-specific signing/API refetch; no DB business effects. Transport authentication alone cannot authorize fulfillment   |

Preserve provider raw status. A normalized observation can distinguish pending,
authorized (hold only), captured, cancelled/failed, partial/full refund and
unknown. Unknown/new/malformed states fail closed. Do not map `AUTHORIZED` or
`waiting_for_capture` to paid/captured, and do not discard a refund because the
payment was previously captured. Model refund state separately where the
provider does so. One-stage hosted payment is a candidate, not a decision to
silently capture two-stage authorizations; if capture is chosen, add that
operation deliberately in EGO-100.

## Verification and retry semantics

ЮKassa's notification authenticity guidance differs from Т-Банк's Token
canonicalization: see the [official-source comparison](../product/payment-provider-decision.md#comparison-template).
For ЮKassa, use an authenticated API read to verify current payment object and
binding; an arbitrary webhook body or IP alone is insufficient business proof.
For Т-Банк, verify its exact documented Token rules with constant-time comparison,
then authenticate/refetch authoritative payment data before effects. Do not
invent a common HMAC secret or rely on signed top-level fields to authenticate
unsigned nested metadata. A spoofed event can at most trigger a bounded read;
only bound provider-authoritative data may enter the service.

Reject missing/wrong merchant, environment, amount, currency or internal Order
binding. Use trusted proxy rules for IP checks and provider-maintained ranges if
required; no ad-hoc static allowlist. Apply body/rate/time limits. Keep credentials,
raw webhook bodies, card/receipt personal data and checkout tokens out of logs;
log sanitized IDs/state/reasons. Browser return redirects are navigation only.

Persist operation key and request fingerprint before external calls. Exact retry
uses the same key and payload. Same key + changed parameters must be rejected.
Maintain database uniqueness/dedup beyond provider key retention (ЮKassa documents
24h). Do not assume Т-Банк Init deduplicates every timeout; confirm its contract
in sandbox. Refund keys must be separate from payment keys; for eacq Cancel map
to `ExternalRequestId` only after verifying its current semantics.

Timeout/5xx means **unknown outcome**, not declined. Reconcile the stored attempt
using provider/Order lookup before creating anything new. No blind new key and
no second-provider retry. If a selected provider cannot meet safe duplicate and
ambiguous-outcome requirements, keep it blocked or require manual reconciliation.

EGO-100 alone owns local Order/payment/refund persistence, durable event receipt
and reconciliation, amount verification, eligibility and Slot locks, atomic
placement/earnings changes and compensating refunds. One provider payment can
fulfill at most one Order; one Order at most one takeover. Expired/cancelled
reservation plus late payment requires refund/manual review, never blind takeover.
Provider network calls must not be performed while holding Slot locks.

Refund reconciliation must read the provider's authoritative refund object/status,
not infer completion from a captured payment. For the selected ЮKassa primary,
model its separate refund objects with a
narrowly scoped `getRefund` operation alongside the EGO-100 reconciliation
consumer. Preserve raw payment/refund statuses and authenticated amount/Order
binding; no local fulfillment follows from a browser redirect. If Т-Бизнес is
later integrated, use its documented method-specific refund lookup. The
four-operation sketch is a starting point, not a reason to
omit required reconciliation or force every provider into an inaccurate model.

## Config and secrets plan (documented, not added to runtime)

No payment variables are added to `.env.example` or current Zod config because
there is no consumer yet. When EGO-100 adds one, extend the existing config loader
and tests, without a permissive default/fake credential fallback:

| Proposed field                                    | Rule                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `PAYMENT_PROVIDER`                                | Explicit ЮKassa selection for initial EGO-100; no fallback default                                |
| `PAYMENT_MODE`                                    | Explicit `sandbox` / `live`, independent of `NODE_ENV`                                            |
| ЮKassa: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | Non-empty server-only pair from matching test/live shop                                           |
| Т-Банк: `TBANK_TERMINAL_KEY`, `TBANK_PASSWORD`    | Non-empty server-only pair from matching terminal; do not treat password as a generic HMAC secret |
| Return/webhook settings                           | Approved HTTPS origins/paths, bound to deployment environment; no arbitrary client URL            |
| Receipt settings                                  | Approved legal/tax configuration; do not guess tax code or bypass required receipt input          |

Only selected provider fields are required; reject contradictory configuration.
Missing/inconsistent configuration disables payment initialization (or fails API
startup once payments are explicitly enabled), never silently falls back to live
or sandbox. Staging/local/test accept sandbox only; production accepts live only
after a separate explicit human activation gate. No arbitrary credential/API URL
from user input. Validate known provider endpoints and authenticated shop/test
identity where the provider exposes it; when mode cannot be machine verified,
require documented terminal/account verification rather than trusting a prefix.
Do not use fake credentials for a runnable provider path.

Use existing staging/production API Lockbox separation, `json-rest` renderer and
0600 env files. No `NEXT_PUBLIC_` payment secrets; no worker/publisher access unless
a real consumer needs it. Sandbox references and approved test credentials are
handled by the operator, never committed or printed. Production secret storage
and payment activation require a separate authorization; this task touches neither.

## EGO-100 tests for the selected ЮKassa sandbox

- Provider contract fixtures: exact amount conversion, merchant/mode/correlation,
  hosted redirect allowlist, supported/raw/unknown statuses, malformed responses.
- ЮKassa verification failures: spoofed event, mismatched authenticated lookup,
  altered metadata, wrong
  merchant/test mode/currency/amount/Order, bad IP/proxy input, oversized body.
  Signature tests belong to a future Т-Банк adapter; do not invent a ЮKassa HMAC.
- Durable operation retry: concurrent duplicate create/refund, stable key/payload,
  changed payload rejection, timeout after provider accepted, delayed status read,
  local dedup after provider retention and no automatic fallback charge.
- Duplicate/out-of-order webhooks and authenticated reconciliation. Fake fixtures
  test local logic; genuine sandbox evidence must validate the provider protocol.
- Existing required PG integration/concurrency invariants: Slot locking, at-most-
  once Order/payment/takeover, expired paid reservation, refund/manual review,
  earnings/ledger corrections. No ownership changes from frontend/provider status
  alone. Never mark these tests as implemented by the offline EGO-99 calculator.
