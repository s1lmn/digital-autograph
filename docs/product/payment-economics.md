# Configurable acquiring cost model (EGO-99)

This is an **offline planning estimate**, not a tariff quotation, tax decision,
payment authorization, ledger or platform profit model. It performs no network
calls, reads no environment credentials and changes no database/storage. Use
separate input files for ЮKassa and Т-Бизнес with dated written terms from the
[decision record](payment-provider-decision.md). The accepted decision is ЮKassa
primary / Т-Бизнес fallback; actual
commercial rates, VAT treatment, receipt/refund and settlement terms remain
REQUIRES CURRENT HUMAN VERIFICATION. The template remains unfilled, with no preset
provider rate; sandbox availability does not supply live commercial terms.

Copy [payment-economics.template.json](payment-economics.template.json) to a local
file, replace every `null` with a verified assumption, and run with Node 24:

```sh
node scripts/payment-economics.mjs /tmp/acquiring-scenario.json
```

The unfilled template intentionally fails; unknown costs must not silently become
zero. Input files contain commercial/planning inputs only, **never credentials**.
Document provider, source/date, entity/tax regime and forecast owner alongside the
file, not as extra JSON keys (unknown keys are rejected to catch typos).

## Approved product ladder — 27.10.2026

The owner approved 89 RUB base/minimum, +100 RUB for each successful Wall takeover,
4989 RUB cap,900-second protection and 50% creator remuneration **rate**. See
[Pricing Spec v1](pricing-spec-v1.md) and run `pnpm pricing:plan` for the exact
no-decay ladder GMV matrix. The average ticket is derived from the actual sequence,
not the final price or number of Slots. Current method fees remain unfilled.
Creator revenue basis/refund/chargeback rules and price decay are still pending;
no production setting or public tariff is activated. Consequently payout and
contribution margin remain unknown, even with the approved rate.

The original 100-RUB fee example below remains a deliberately synthetic arithmetic
regression; it is not the Destka tariff. Use the approved ladder's computed
average only with separately verified merchant/volume/mix/fiscal assumptions.

## Inputs

Money is integer RUB kopecks (`10000` = 100 RUB). Basis points are integers
(`100` = 1%, `10000` = 100%). All inputs are required, including explicit verified
zero fees. Add/remove methods to match the approved mix; shares total 10000.

| Field                                    | Meaning                                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currency`                               | `RUB` only                                                                                                                                                                                                                |
| `averagePaymentMinor`                    | Average captured payment, positive, at most 1,000,000,000 kopecks                                                                                                                                                         |
| `monthlyVolumes`                         | 1–12 distinct positive captured-payment counts, each at most 10,000,000                                                                                                                                                   |
| `methods[].name`                         | Unique short identifier (`card`, `sbp`, `tpay`, etc.), 1–12 methods                                                                                                                                                       |
| `shareBps`                               | Share of captured payments for this method; model assumes the same average ticket for every method                                                                                                                        |
| `commissionBps` / `fixedFeeMinor`        | Quoted percentage / fixed acquiring fee per captured payment, before or including VAT as specified                                                                                                                        |
| `acquiringVat`                           | Explicit VAT policy on this method's percentage + fixed acquiring fee                                                                                                                                                     |
| `refundRateBps`                          | Expected fraction of captured payments with one refund event                                                                                                                                                              |
| `refundedAmountBps`                      | Mean refunded fraction of principal among those refunds; 10000 full, 5000 half                                                                                                                                            |
| `acquiringFeeReturnedBps`                | Fraction of the original acquiring fee credited per refund event; independent of refunded principal fraction. Obtain actual full/partial refund rules; input their expected fee credit fraction, not an assumed prorating |
| `refundFee`                              | Additional service fee per refund event and its VAT policy, not refunded principal                                                                                                                                        |
| `paymentReceiptFee` / `refundReceiptFee` | Per-payment / per-refund receipt/OFD costs and respective VAT policies                                                                                                                                                    |
| `monthlyCashRegisterFee`                 | Monthly register/OFD/fiscal service costs with VAT policy; may include explicitly amortized setup cost for the chosen horizon                                                                                             |

Each fixed charge is `{ "amountMinor": ..., "vat": ... }`. Every VAT policy is:

```json
{ "mode": "none", "rateBps": 0, "recoverableBps": 0 }
```

`mode` is `none`, `included` or `added`. `none` requires zero VAT rate/recovery;
otherwise a positive rate is required. `recoverableBps` is the accountant-approved
share of VAT recoverable (0–10000). No statutory rate or recovery eligibility is
assumed. Different methods, refund and receipt/register fees have separate
policies. Rates/probabilities/shares are bounded at 10000, quoted fixed charges at
1,000,000,000 kopecks. Fractional inputs, missing/null/unknown fields, duplicate
methods, inconsistent VAT and zero/duplicate volumes fail with exit 1 and no
input echo.

## Calculation / output

Let `A` be average payment, `sᵢ` method share, `cᵢ` quoted rate, `fᵢ` fixed fee,
`rᵢ` refund probability, `uᵢ` fraction of acquiring fee credited on refund and
`pᵢ` refunded principal fraction. Rates here are fractions after dividing bps by 10000. For any quoted charge `Q`:

| VAT mode | Cash charge | VAT portion     |
| -------- | ----------- | --------------- |
| none     | Q           | 0               |
| included | Q           | Q × v / (1 + v) |
| added    | Q × (1 + v) | Q × v           |

Economic charge = cash charge − VAT portion × recoverable fraction. A returned
acquiring fee is assumed to reverse the same proportional VAT/recovery; if the
contract differs, use an explicit separate scenario and accountant reconciliation.

| Output                                | Calculation / interpretation                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `quotedBlendedCommissionPercent`      | Σ sᵢ × cᵢ × 100; percentage component only, excludes fixed fees/VAT/refunds                            |
| Acquiring cash/economic cost          | Σ sᵢ × fee(A × cᵢ + fᵢ) × (1 − rᵢ × uᵢ)                                                                |
| Refund service cost                   | Σ sᵢ × rᵢ × refund service fee                                                                         |
| Receipt cost                          | Payment receipt + Σ sᵢ × rᵢ × refund receipt                                                           |
| `cashCostMinor` / `economicCostMinor` | Sum above, excluding monthly register cost in per-payment block                                        |
| `recoverableVatMinor`                 | Cash cost minus economic cost; recovery is an assumption, not immediate cash settlement                |
| `effectiveCostPercent`                | Economic acquiring + refund service + receipts / A × 100                                               |
| `netAfterFeesMinor`                   | A − economic costs; before refunded principal, platform taxes, creator share, infra and other expenses |
| `expectedRefundedPrincipalMinor`      | A × Σ sᵢ × rᵢ × pᵢ; reported separately, never counted as a provider fee                               |
| `retainedAfterFeesAndRefundsMinor`    | Net after fees minus expected refunded principal; still not profit                                     |
| Monthly cost by volume N              | N × per-payment cost + monthly register fee; both cash and economic totals                             |
| Monthly cost/payment and effective %  | Includes register fee / N                                                                              |
| Monthly net / retained                | N × per-payment net / retained − monthly economic register fee                                         |

Results retain up to six decimal places **in kopecks** for averages; do not round
to actual payment/receipt amounts. JavaScript arithmetic is appropriate for
bounded planning estimates only. Runtime payments must use exact minor-unit
amounts with provider-specific conversion and backend authority in EGO-100.

## Hand-checked synthetic example

This example is regression arithmetic, **not ЮKassa/Т-Бизнес rates or a current tax
rate**. A = 10000 kopecks; card share 7000 bps / commission 300 bps with 2000 bps
VAT added and no recovery; SBP share 3000 / commission 100 with no VAT; no fixed
acquiring fees. Card refunds occur at 1000 bps, refund full principal, return no
acquiring fee and cost 50 kopecks; SBP refunds zero. Payment receipt costs 20,
refund receipt 10, monthly register 1000 (all these fees have no VAT).

| Result                                       | Estimate                                         |
| -------------------------------------------- | ------------------------------------------------ |
| Quoted blended commission                    | 2.4%                                             |
| Acquiring cost/payment                       | 282 kopecks                                      |
| Refund service + receipt cost/payment        | 3.5 + 20.7 kopecks                               |
| Total cost/payment (before monthly register) | 306.2 kopecks / 3.062%                           |
| Net after fees                               | 9693.8 kopecks                                   |
| Expected refunded principal                  | 700 kopecks                                      |
| Retained after fees and refunds              | 8993.8 kopecks                                   |
| 100 payments/month                           | 31620 kopecks total cost, 316.2/payment, 3.162%  |
| 1000 payments/month                          | 307200 kopecks total cost, 307.2/payment, 3.072% |

## Limits / review before decision

The model assumes equal tickets across methods and one mean refund event per
refunded payment, linear percentage/fixed charges and no tariff minimum/maximum
caps or tier discontinuities. For different tickets, repeated partial refunds,
fee caps, settlement charges or complex tiers, run separate documented scenarios
or extend the model after obtaining terms; do not conceal these with guessed rates.
Cash/economic totals can be negative in net outputs and are not clamped.

Declined attempts, chargebacks, fraud losses, FX, time-to-settlement, reserves,
creator payouts, platform revenue taxes and infrastructure costs are not modeled.
Complete pricing/profit/creator-share analysis in EGO-66 and tax/receipt decisions
in EGO-77. Neither configurable VAT nor an offline scenario substitutes for an
accountant's approval or provider quote. Compare both providers only with the same
forecast assumptions, enabled methods and dated all-in terms.
