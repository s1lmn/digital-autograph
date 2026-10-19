# EGO-75: paid checkout confirmation

Preparation only. Stack: #46 → #52 → #53 → checkout. No deployment, acquiring
activation or legal approval. All real document editions remain `ready: false`;
new Orders fail closed. The route is not advertised by Wall navigation. URL
references, cookies and query parameters cannot publish documents or enable a
provider. EGO-72/75/77/110 remain open.

## Display and admission

`GET /payments/checkout?reservationId=…&autographId=…` is authenticated, owner-only
and no-store. PostgreSQL supplies the pinned amount/currency, pricing version,
guaranteed visibility seconds, reservation expiry, target placement, Wall/creator,
slot number and approved autograph identity. Existing quote/reservation APIs remain
the source of admission; the UI does not select a substitute slot or calculate a
new price. The private cleaned preview uses the existing owner-only preview API.

`/payments/checkout` is Russian and uses Destka tokens. It displays the temporary
replacement service, full RUB price, guaranteed period starting at fulfillment,
reservation deadline and possible later replacement. It links exact archived
editions of Offer, Rules and Refund Policy. One separate unchecked checkbox confirms
these paid conditions; it grants no personal-data consent and cannot replace
first-use age/Terms/Rules evidence. Private preview loading and publication-byte
verification must complete before submission.

The API registry is authoritative. All three current editions must be ready,
placeholder-free, have canonical API paths and match SHA-256 of their exact text.
The browser additionally fetches those published editions and verifies their
bytes/hash. Unavailable text, a changed edition, failed preview or network error
cannot silently authorize a new Order.

`POST /payments/orders` accepts strict `{reservationId, autographId, confirmation}`.
For a new admission, `confirmation` requires `confirmed: true`, the three exact
`type/version/hash` identities and displayed economic preconditions. Preconditions
are compared against PostgreSQL and the server registry; INSERT still copies
price/target/creator/pricing fields from trusted rows. No client price, share,
return URL or provider URL authorizes an order. First-use evidence is checked again
in the admission transaction. A new edition returns `CHECKOUT_TERMS_CHANGED`, an
expired reservation `RESERVATION_EXPIRED`, and an unavailable target
`RESERVATION_NOT_ELIGIBLE`. The user must reread and explicitly confirm new terms.

## Atomic immutable evidence

Forward-only `0019_checkout_confirmation.sql` adds `checkout_confirmations`, one
row per Order. It records the authenticated subject, reservation, autograph,
three document identities, amount/currency, visibility guarantee, expiry, target,
pricing identity, `source=web`, `context=paid_checkout` and PostgreSQL confirmation
time. It describes explicit checkout confirmation, not a paid contract or fulfillment.

Order, confirmation and Payment (including original provider key/fingerprint)
commit in one PostgreSQL transaction before any provider call. A deferred constraint
requires confirmation for every newly inserted Order. The confirmation insert guard
requires exact binding to that Order, reservation and immutable pricing config;
caller timestamps are replaced by database time. UPDATE/DELETE are rejected. Old
Orders receive no fabricated confirmation. Migrations 0017/0018 and canonical
legal source bytes/hashes are unchanged.

The existing Wall → Slot → Placement → Reservation lock order serializes
concurrent admissions. PostgreSQL time is sampled after waits. Same reservation
and autograph return the original Order before new-edition validation; another
autograph conflicts. Retries retain the original confirmation, snapshots, provider
key/payload and Payment. Twenty parallel admissions across pools produce one set.

`DISABLE_NEW_PAYMENTS` rejects new quote/reservation/checkout admissions. A retry
of an already-admitted Order is recovery and remains possible, as do owner status,
refresh, webhook and reconciliation. There is no new provider/payment state machine.
Publication changes do not rewrite admitted Orders or retry with a new key.
Browser reload queries the owner-only reservation/Order and restores its status
and safe provider link while payment is pending. Rechecking terms uses the same
read-only recovery path and never creates another Order or payment identity,
without persisting acceptance as client authorization. Ambiguous network failure
retries the same reservation; it never creates another payment identity.

## Payment boundary and limitations

Confirmation, Order creation, provider initiation, verified payment and fulfillment
are separate facts. The hosted URL comes only from the existing authenticated
YooKassa adapter with its exact HTTPS YooMoney origin safety checks; the browser
rechecks URL safety before rendering the link. Destka never collects card numbers,
CVV/CVC, banking passwords or SMS codes. A browser return is navigation only.

Late/ineligible paid Orders still use the existing `paid_but_not_fulfilled` manual
compensation path. This layer does not implement automatic refunds or claim that
those financial/fiscal launch gates are complete. Offer sections 3/4 and clause
4.5 require confirmed payment in the reservation period; checkout confirmation
alone must never be reported as a paid/executed contract. Legal publication,
operator/fiscal approval and genuine provider callback/refund validation remain
launch blockers.

E2E uses explicitly injected synthetic published texts and an in-memory
sandbox-shaped provider, guarded by the isolated non-production test composition.
Production `main.ts` passes neither fixture. No environment/query/cookie bypass,
real credential or external payment request is introduced. The tests prove local
transaction/browser behavior, not genuine sandbox completion.
