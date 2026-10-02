# EGO-99: acquiring provider decision record

Status: **Provider decision accepted: ЮKassa primary, Т-Бизнес fallback.
ЮKassa sandbox available; production onboarding/KYB pending. EGO-99 is not Done.**
Decision owner: Egor (project owner); human confirmation recorded 2026-10-02.
Audit date: 2026-10-02. Repository baseline:
`8d78cd9d169568a0e7daa60badfb9871a0c3b09b` (`origin/main`).

[EGO-99](https://linear.app/egor-loshkarev/issue/EGO-99/0403-vybrat-i-podklyuchit-platyozhnogo-provajdera-dlya-mvp)
records the accepted acquiring selection and prepares integration readiness.
Payment orchestration, Order persistence, webhook
business effects, earnings, and atomic takeover belong to
[EGO-100](https://linear.app/egor-loshkarev/issue/EGO-100/0404-realizovat-payment-orchestration-webhooks-i-atomic-takeover).
This record does not authorize production activation or financial operations.

## Read-only repository audit

Paths below are relative to the repository root. PASS describes an existing
foundation, not an implemented payment flow. Provider decision and sandbox
availability below reflect the project owner's confirmation; this update did not
read Lockbox payloads or perform provider API calls.

| Requirement                                   | Result  | Evidence                                                                                                                                                                         | Action                                                                                               |
| --------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Backend-authoritative amount/currency         | PASS    | `packages/walls/src/pricing.ts`, `packages/db/src/pricing-repository.ts`, `apps/api/src/walls/pricing-http.ts`, `docs/architecture/pricing.md`                                   | Bind payment to the stored quote; never accept browser price as authority                            |
| Reservation/idempotency/Slot locks            | PASS    | `packages/walls/src/reservation.ts`, `packages/db/src/takeover-reservation-repository.ts`, `apps/api/src/walls/reservation-http.ts`, `docs/architecture/takeover-reservation.md` | Re-read eligibility under locks in EGO-100; expired/cancelled reservations cannot authorize takeover |
| Provider decision                             | PASS    | Egor confirmed ЮKassa primary / Т-Бизнес fallback; decision below                                                                                                                | Implement only the primary adapter in EGO-100                                                        |
| Production merchant approval / KYB            | MISSING | Human input explicitly leaves production onboarding/KYB pending                                                                                                                  | Complete merchant review and approval; no live activation                                            |
| Provider adapter                              | MISSING | `packages/integrations/src/` contains auth/private S3 adapters, no acquiring adapter; `apps/api/src/main.ts` composes them                                                       | Use the [proposed boundary](../architecture/payment-provider-boundary.md) when implementing EGO-100  |
| Order/Payment/Refund/ledger                   | MISSING | `packages/db/src/schema.ts` has quote/reservation but no payment/Order/refund/ledger tables                                                                                      | EGO-100 scope; do not add unused tables here                                                         |
| Safe config/secret mechanism                  | PARTIAL | `packages/config/src/index.ts`, `.env.example`, `deploy/render-lockbox-env.mjs`, `deploy/deploy-on-vm.sh`, `docs/operations/deployment.md`                                       | Document payment config now; add validated consumed config only with adapter                         |
| Public merchant information/approved consents | MISSING | `apps/web/app/page.tsx` is bootstrap; no seller, terms, offer, privacy, refund or contact routes; consent schema is not approved legal content                                   | Close the merchant gaps below after legal review                                                     |
| Acquiring economics inputs                    | MISSING | No approved acquiring tariff, mix, average ticket or settlement terms                                                                                                            | Use the [configurable planning model](payment-economics.md), obtain written current terms            |
| Test foundation/private storage               | PASS    | `vitest.config.ts`, `tests/integration/`, `tests/e2e/`, `docs/operations/e2e.md`, private S3 adapter                                                                             | Add provider contract tests in EGO-100; preserve original upload privacy                             |
| ЮKassa sandbox credentials                    | PASS    | Egor confirmed test shop created and shopId/secretKey stored externally in Yandex Lockbox; values unavailable to repository                                                      | Development uses operator-managed secret reference; validate provider protocol in EGO-100            |
| Live merchant credentials / activation        | MISSING | No production credentials or activation confirmed                                                                                                                                | Separate approval and production secret handling; no production changes here                         |

## Comparison template

**H = REQUIRES CURRENT HUMAN VERIFICATION.** Every H must be replaced by a dated
answer, source/contract reference, and owner before commercial/live readiness is
approved. Primary/fallback selection is already accepted independently of these
remaining checks.
Documentation confirms an API capability, not availability or terms for this
merchant. Technical documentation checked on 2026-10-02; recheck at integration.
Commercial rates are deliberately absent.

| Field                           | ЮKassa                                                                                                                                                  | Т-Бизнес (internet acquiring / eacq)                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onboarding / KYB                | Application, company information, documents, contract [Y1]; exact docs/timeline/activity approval: H                                                    | Company/IP application [T1]; exact docs/timeline/activity approval: H                                                                                                                                       |
| ИП / ООО                        | Provider supports business onboarding [Y1]; selected entity and seller/agent model eligibility: H                                                       | Provider describes IP/legal-entity eligibility [T1]; selected activity/seller model eligibility: H                                                                                                          |
| Cards                           | Payment API capability [Y2]; enabled networks/currencies/restrictions: H                                                                                | Hosted payment form [T2]; enabled networks/currencies/restrictions: H                                                                                                                                       |
| СБП                             | Confirm method activation, API/mobile return and refund conditions: H                                                                                   | Advertised payment method [T1]; activation, API/mobile return and refund conditions: H                                                                                                                      |
| T-Pay / SberPay / other methods | Confirm required method availability, enablement, minimums and browser support: H                                                                       | T-Pay, SberPay, Alfa Pay, Mir Pay and СБП advertised [T1]; merchant activation and method-specific fees: H                                                                                                  |
| Create payment API              | `POST /v3/payments`, authenticated server call [Y2]                                                                                                     | eacq `/v2/Init`, `TerminalKey`, integer minor-unit `Amount`, `OrderId`, `Token` [T2]; do not substitute separate payouts/funding APIs                                                                       |
| Confirmation / redirect         | Redirect confirmation, provider-managed checkout [Y2]; one-stage vs capture choice: H                                                                   | `PaymentURL` returned to browser [T2]; one-stage vs capture choice: H                                                                                                                                       |
| Webhook verification            | Provider recommends checking object status via authenticated API or sender IP [Y3]; no shared-secret HMAC assumption                                    | Notification `Token`, provider SHA-256 canonicalization rules (top-level parameters, excludes nested objects) [T3]; verify exact notification contract before coding                                        |
| Idempotency                     | `Idempotence-Key` for POST/DELETE; documented 24h retention [Y4]; local durable dedup still required                                                    | Stable `OrderId` identifies merchant order [T2]; do not assume Init is exactly-once. Verify duplicate/timeout behavior and retention: H. `Cancel.ExternalRequestId` checks prior refunds when supplied [T4] |
| Full refunds                    | Refund API [Y5]; enabled methods, deadlines, settlement and fee policy: H                                                                               | `Cancel` after captured payment [T4]; method restrictions, deadlines, settlement and fee policy: H                                                                                                          |
| Partial refunds                 | Amount-based partial refunds documented [Y5]; method limits/receipt corrections: H                                                                      | Amount-based partial refunds and receipt positions documented [T4]; method limits/receipt corrections: H                                                                                                    |
| Payment statuses                | `pending`, `waiting_for_capture`, `succeeded`, `canceled` [Y6]; refunds are separate observations                                                       | `CONFIRMED` captures payment; `AUTHORIZED` is a hold; refunds include `PARTIAL_REFUNDED` / `REFUNDED` [T2,T4]. Keep raw status and fail closed on unknown status                                            |
| Fiscal receipt integration      | Confirm cashier/service, API receipt fields, return receipts and legal applicability: H                                                                 | Receipt integration described [T5]; chosen cash register, receipt fields, return receipts and legal applicability: H                                                                                        |
| Settlement schedule             | Banking days, cutoffs, reserves, holdbacks, reconciliation files: H                                                                                     | Banking days, cutoffs, reserves, holdbacks, reconciliation files: H                                                                                                                                         |
| Settlement/payout limits        | Per-payment/daily/monthly limits, minimums, account restrictions: H                                                                                     | Per-payment/daily/monthly limits, minimums, account restrictions: H                                                                                                                                         |
| Sandbox                         | AVAILABLE — test shop and credentials in Yandex Lockbox, confirmed by Egor; supported methods, redirect/webhook/refund protocol validation: H / EGO-100 | Fallback only; test terminal/credentials not confirmed, H if fallback integration is later authorized [T6]                                                                                                  |
| Production activation           | KYB, contract, approved site, enabled methods, live keys, limits: H                                                                                     | KYB, contract, approved site, enabled terminal/methods, live keys, limits: H                                                                                                                                |
| Website requirements            | Provider site checklist [Y8]; merchant-specific acceptance and legal texts: H                                                                           | Provider site requirements [T1]; merchant-specific acceptance and legal texts: H                                                                                                                            |
| Support / escalation            | Current merchant manager/channel, incident contact, SLA and escalation: H                                                                               | Current merchant manager/channel, incident contact, SLA and escalation: H                                                                                                                                   |
| Commission                      | Dated written per-method quote, volume tiers/minimum fees: H                                                                                            | Dated written per-method quote, volume tiers/minimum fees: H                                                                                                                                                |
| VAT / taxes on fees             | Included/additional/exempt per fee and recoverability: H (accountant + contract)                                                                        | Included/additional/exempt per method/fee and recoverability: H (accountant + contract)                                                                                                                     |
| Cash-register / receipt costs   | Setup, monthly, per-payment, refund receipt, OFD/fiscal services: H                                                                                     | Setup, monthly, per-payment, refund receipt, OFD/fiscal services: H                                                                                                                                         |
| Operational risks               | Timeouts/ambiguous outcomes, duplicate/delayed notifications, refund availability, settlement holds, outage handling; merchant terms: H                 | Same risks plus exact signing/duplicate request semantics and method-specific refund states; merchant terms: H                                                                                              |

Merchant acquiring settlement is **not creator payout integration**. Creator
payout agreements, tax treatment and operational controls belong to
[EGO-78](https://linear.app/egor-loshkarev/issue/EGO-78/0107-sproektirovat-creator-payouts-i-operacionnuyu-shemu-vyplat).
Fallback means a separately approved contingency provider, not automatic retry
at a second provider after an ambiguous first payment.

### Accepted decision and remaining inputs

| Input                                                                  | Approved answer / evidence                                                                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision owner / date / next review date                               | Egor / 2026-10-02 human confirmation / next review date: H                                                                                                                       |
| Legal seller / entity / seller-of-record vs agent                      | H — EGO-72                                                                                                                                                                       |
| Approved activity, temporary placement description, merchant category  | H                                                                                                                                                                                |
| Required methods and forecast mix                                      | H                                                                                                                                                                                |
| Average/min/max payment and monthly volumes                            | H — EGO-66                                                                                                                                                                       |
| Primary / fallback provider and rationale                              | ACCEPTED: ЮKassa / Т-Бизнес; technical rationale below                                                                                                                           |
| Cost comparison using dated quote + tax assumptions                    | H — attach model inputs/output; no keys                                                                                                                                          |
| KYB/contract approval reference                                        | H — restricted evidence location, not documents in Git                                                                                                                           |
| ЮKassa sandbox availability / credentials                              | AVAILABLE: test shop created; shopId and secretKey stored externally in Yandex Lockbox. Values unavailable to repository; operator provides only a safe reference/access handoff |
| Configured sandbox methods / protocol test evidence                    | Not validated by this documentation update; method settings: H; API/redirect/webhook/refund validation: EGO-100                                                                  |
| Receipt solution, nomenclature, tax codes, refund receipt requirements | H — EGO-77 / EGO-101                                                                                                                                                             |
| Settlement/refund/late payment and incident handling accepted          | H                                                                                                                                                                                |
| Production activation owner and explicit approval gate                 | H — production remains disabled                                                                                                                                                  |

### Selection rationale and evidence scope

The project owner chose **ЮKassa as primary** and **Т-Бизнес as fallback**.
Technical rationale for proceeding with ЮKassa:

- A real test shop and sandbox credentials are already available externally,
  removing the credential-provisioning prerequisite for primary adapter work.
- Its documented hosted redirect, authenticated payment lookup, idempotency keys
  and separate refund objects fit the prepared integration boundary and existing
  backend-authoritative quote/reservation model [Y2–Y6].
- One primary adapter keeps initial EGO-100 integration focused. Т-Бизнес remains
  a contingency choice; its onboarding/credentials are not claimed complete and
  it is not an automatic retry destination for ambiguous payments.

These are technical reasons for implementing the accepted human choice, not a
verified price advantage or a claim that merchant activity/KYB is approved.
Commercial tariffs, VAT, settlement, fiscalization and refund/support terms remain
H. No provider credentials or payloads were inspected in this update. Sandbox
availability is confirmed by the owner; actual integration remains unvalidated.
The exact Lockbox reference/name and access handoff are operator-managed, not
invented here. Secret values are unavailable to the repository, PR and this record.

## Merchant website gaps

The open frontend work does not substitute for approved merchant/legal content.
Do not generate fictional requisites, legal promises or empty compliance pages.

| Gap                                                                                             | Required source / dependency                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who sells/provides the digital service, seller-of-record/agent role                             | [EGO-72](https://linear.app/egor-loshkarev/issue/EGO-72/0101-vybrat-yuridicheskuyu-model-biznesa-i-rol-platformy): In Progress, no approved memo supplied                                                                                      |
| IP/OOO legal name, requisites, address and service/support contacts                             | Human-approved entity data + EGO-72; publish only approved information                                                                                                                                                                         |
| Service description (temporary placement, displacement/history; no permanent ownership promise) | Product owner + [EGO-75](https://linear.app/egor-loshkarev/issue/EGO-75/0104-podgotovit-polzovatelskie-yuridicheskie-dokumenty-i-consent-flows) approved offer/terms                                                                           |
| RUB prices and backend quote mechanism, reservation expiry, payment procedure                   | Existing pricing/reservation docs + [EGO-66](https://linear.app/egor-loshkarev/issue/EGO-66/0003-sproektirovat-pricing-model-i-unit-economics-mvp) + approved offer; no invented price guarantee                                               |
| Cancellation/refunds, late successful payment, dispute/support procedure                        | EGO-75 plus selected provider written rules; business handling in EGO-100                                                                                                                                                                      |
| Terms/offer/privacy/publication and personal-data consents, versions                            | EGO-75 and [EGO-74](https://linear.app/egor-loshkarev/issue/EGO-74/0103-sproektirovat-kontur-personalnyh-dannyh-i-lokalizaciyu); existing consent table alone is insufficient                                                                  |
| Tax/cash-register/receipt fields and customer contact collection                                | [EGO-77](https://linear.app/egor-loshkarev/issue/EGO-77/0106-vybrat-nalogovuyu-shemu-okved-kassu-i-poryadok-chekov), then [EGO-101](https://linear.app/egor-loshkarev/issue/EGO-101/0405-realizovat-fiskalnye-cheki-i-reconciliation-s-kassoj) |
| Creator license/remuneration relationship                                                       | [EGO-76](https://linear.app/egor-loshkarev/issue/EGO-76/0105-podgotovit-creator-agreement-i-pravila-verifikacii) / EGO-78; not implied by acquiring                                                                                            |
| Provider review evidence                                                                        | Human obtains a current checklist and written acceptance for the actual site/entity/activity                                                                                                                                                   |

## Human-only checklist (Egor)

Completed by human confirmation on 2026-10-02:

- [x] Select ЮKassa primary and Т-Бизнес fallback.
- [x] Create the ЮKassa sandbox shop and obtain sandbox shopId/secretKey.
- [x] Store sandbox credentials externally in Yandex Lockbox; values unavailable
      to the repository. Development accesses them through the secret manager.

Remaining human work:

1. Open current official provider pages; confirm this exact digital-service
   activity, entity/seller-of-record model and merchant website requirements.
2. Obtain dated written terms: enabled methods, minimum/fixed fees, VAT,
   refund/chargeback costs, settlement timing/reserves/limits, cash-register/OFD
   costs and support/escalation contacts. Accountant validates applicable tax
   treatment. These fields remain REQUIRES CURRENT HUMAN VERIFICATION.
3. Resolve seller model (EGO-72), approved public documents/consents (EGO-75/74),
   fiscal plan/receipt inputs (EGO-77) and provider site acceptance.
4. Define required methods, forecast amount/volume/mix, cancellation/late-payment
   and incident policies. Add the commercial rationale when written terms exist.
5. Complete production merchant/KYB application, genuine documents, contract and
   approval through the provider's secure channel. No private documents in Git/chat.
6. Hand off only the safe Lockbox reference/access owner for EGO-100 sandbox work;
   confirm method/return/webhook settings and approved receipt test inputs. Real
   sandbox API/redirect/webhook/refund validation belongs to EGO-100 and has not run.
7. After technical sandbox verification and merchant approval, separately
   authorize production credentials/storage and live activation. No production
   credentials are added or production activated by this task.
8. Record written settlement/refund/support acceptance and remaining evidence
   dates, then reassess the full EGO-99 DoD. Selection and sandbox availability do
   not complete production onboarding. Fallback onboarding remains separate if needed.

Remaining data needed from Egor: approved legal seller/entity and activity;
public texts/requisites/contacts; target methods/mix/amounts/volumes; written
provider terms; receipt/accountant decisions; KYB/contract status; safe sandbox
secret reference/access handoff and method settings; settlement/refund/support
owners. **No secret values needed in a reply.** Primary/fallback choice and
sandbox creation/credential storage are already confirmed.

After this preparation PR merges, the technical foundation is ready to start
EGO-100 with the selected ЮKassa sandbox. The developer retrieves credentials via
an authorized secret-manager handoff during EGO-100; real provider contract tests
and receipt/config decisions are part of that implementation. Production legal,
commercial, fiscal and KYB completion remain independent gates. EGO-100 is not
implemented or started by this update; EGO-99 remains incomplete.

## Official sources

- Y1: [ЮKassa onboarding](https://yookassa.ru/docs/support/payments/onboarding/overview)
- Y2: [ЮKassa API reference](https://yookassa.ru/developers/api)
- Y3: [ЮKassa notifications and verification](https://yookassa.ru/developers/using-api/webhooks)
- Y4: [ЮKassa API interaction and idempotency](https://yookassa.ru/developers/using-api/interaction-format)
- Y5: [ЮKassa refunds](https://yookassa.ru/developers/payment-acceptance/after-the-payment/refunds)
- Y6: [ЮKassa payment process](https://yookassa.ru/developers/payment-acceptance/getting-started/payment-process)
- Y7: [ЮKassa test mode](https://promo.yookassa.ru/test-mode)
- Y8: [ЮKassa website preparation](https://yookassa.ru/docs/support/payments/onboarding/arrangement)
- T1: [Т-Бизнес acquiring requirements](https://www.tbank.ru/business/help/business-payments/internet-acquiring/how-work/working-conditions/) and [methods](https://www.tbank.ru/business/online-payments/internet-acquiring/)
- T2: [Т-Банк hosted checkout](https://developer.tbank.ru/eacq/scenarios/payments/nonPCI) and [Init](https://developer.tbank.ru/eacq/api/init)
- T3: [Т-Банк notifications](https://developer.tbank.ru/eacq/intro/developer/notification) and [Token](https://developer.tbank.ru/eacq/intro/developer/token)
- T4: [Т-Банк refunds](https://developer.tbank.ru/eacq/scenarios/cancel_confirm/) and [Cancel / ExternalRequestId](https://developer.tbank.ru/eacq/api/cancel)
- T5: [Т-Бизнес cash-register integration](https://www.tbank.ru/business/help/business-payments/internet-acquiring/kassa/how-connect/)
- T6: [Т-Банк terminal parameters / test mode](https://developer.tbank.ru/eacq/intro/developer/terminal)

These are decision inputs, not legal/tax advice or signed commercial terms. Some
Т-Банк pages expose their API content in search but cannot be fully retrieved
without browser rendering; confirm the complete current contract with the
provider before implementing an adapter.
