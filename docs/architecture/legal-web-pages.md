# EGO-75 — implemented legal Web routes; publication pending

Routes, archives and publication boundaries were integrated through PR65.
The former stacked-draft prerequisite is historical. All 14 legal entries and
the separate security entry remain `ready: false`; implementation is not legal
approval. EGO-75 and full EGO-110 are not Done. See the current
[merchant readiness checklist](../product/merchant-review-readiness.md).

## Proposed URL contract — owner confirmation still required

The proposed public origin is `https://destka.ru`; no DNS, TLS or deployment is
configured by this PR. Copy-link uses the actual visited Web origin and the
immutable version path, without copying query parameters. API origin is supplied
by `API_INTERNAL_URL`; it is not inferred from a proposed public hostname.

| Legal type                          | Web current alias              | Exact version                                     | Archive                                | Backend exact text                                               |
| ----------------------------------- | ------------------------------ | ------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| terms_of_use                        | `/legal/terms`                 | `/legal/terms/versions/{version}`                 | `/legal/terms/archive`                 | `/legal/documents/terms_of_use/{version}`                        |
| community_guidelines                | `/legal/content-rules`         | `/legal/content-rules/versions/{version}`         | `/legal/content-rules/archive`         | `/legal/documents/community_guidelines/{version}`                |
| public_offer                        | `/legal/offer`                 | `/legal/offer/versions/{version}`                 | `/legal/offer/archive`                 | `/legal/documents/public_offer/{version}`                        |
| refund_policy                       | `/legal/refunds`               | `/legal/refunds/versions/{version}`               | `/legal/refunds/archive`               | `/legal/documents/refund_policy/{version}`                       |
| privacy_policy                      | `/legal/privacy`               | `/legal/privacy/versions/{version}`               | `/legal/privacy/archive`               | `/legal/documents/privacy_policy/{version}`                      |
| personal_data_consent               | `/legal/personal-data-consent` | `/legal/personal-data-consent/versions/{version}` | `/legal/personal-data-consent/archive` | `/legal/documents/personal_data_consent/{version}`               |
| personal_data_dissemination_consent | `/legal/dissemination-consent` | `/legal/dissemination-consent/versions/{version}` | `/legal/dissemination-consent/archive` | `/legal/documents/personal_data_dissemination_consent/{version}` |
| separate security policy            | `/security`                    | `/security/versions/{version}`                    | `/security/archive`                    | `/security/documents/{version}`                                  |

`/legal` lists only approved document types/links. When only approved history
exists, its link leads to the archive; an unapproved current draft cannot hide that
history or become the current alias. All published versions are listed, including
the published current version, with a visible current label. No guessed chronology
or effective dates are inferred from technical version identifiers.

## Publication boundary

- API `GET /legal/documents` and `GET /security/documents` return a bounded registry
  projection `{documents: [{type, version, hash, current, path}]}`. Entries require
  server readiness and no unresolved `[[` placeholder. The projection contains no
  source files/paths, raw manifest, unpublished identities or draft bodies.
- Security has its own config registry/loader with pinned canonical SHA-256. It is
  never a LegalDocumentType, acceptance event, or paid Order snapshot.
- Both catalogues and exact text use `Cache-Control: no-store`. No authentication,
  cookie, query flag, preview header or local source fallback can reveal drafts.
- Web performs uncached, credential-free SSR reads of both published catalogues.
  It validates identities, paths, uniqueness and current ambiguity. Exact text
  additionally requires the published marker, text/plain, valid UTF-8, no
  placeholders and equality with the API's pinned byte hash. Failed lookups return
  404; unavailable/malformed/tampered backend returns a generic Russian safe state.
  No error payload or stale document content is reflected to visitors.
- Next Proxy checks only bounded published metadata before App Router streaming,
  returning a direct safe 404 for unknown/unpublished identities and a 503 for
  backend failure. Routes independently await their gate before returning JSX.
  Its message-only HTML uses existing Brand Kit tokens and contains no user input
  or document text. Proxy is limited to legal/security URLs; it cannot
  authorize publication or acceptance and fetches no text/session.
  Current and immutable-version paths are distinct: history never redirects or
  substitutes current text. React escapes the full canonical text; literal
  paragraphs/numbering/line breaks are preserved using pre-wrap, without raw HTML
  or handwritten legal copy. There is no acceptance checkbox or mutation here.
- Legal/security routes remain noindex/nofollow pending owner URL/publication
  approval; no sitemap or security.txt is introduced. Future indexing/security.txt
  requires approved real canonical URLs, operational contacts and real expiry.
- Footer links to the safe catalogue only. Document-specific links appear only
  from the published API projection. Other product flows/languages remain intact.
- Web tracing explicitly excludes docs/legal sources. Only the API image receives
  the public canonical legal texts and the separate security canonical policy;
  source DOCX/CSV and internal documents are excluded from Web/API runtime sources.
  Build/migration images retain the repository as before; they are not public Web.

## Reproducible checks

`pnpm test:legal-pages` runs after `pnpm build`. It starts an ephemeral loopback
HTTP fixture and the built standalone Web, never toggling a real registry or
calling an external provider. It tests all-draft/unknown/internal 404s, synthetic
published current/history/security, retained history under a newer unapproved
current, backend outage, hash tampering, escaped markup, noindex, no sitemap and
source exclusion from the standalone/client bundle. CI runs this built SSR check.

For local browser verification, run `pnpm test:legal-pages -- --visual` with
Chromium installed. `LEGAL_SMOKE_SCREENSHOTS` may name a directory outside Git.
Checks include 1440/1024/390/320px, 100/200% root text size, exact historical
textContent, long URLs, no horizontal overflow, Russian main language, one h1,
keyboard skip link/focus/copy action and status announcement. Brand tokens supply
existing ink/muted/link/focus contrasts; no new palette or remote font is added.

Unit/API and PostgreSQL regressions verify draft exclusion, separate security,
immutable published reads, malformed projections, no-cache/credential-free
requests, clipboard failures and absence of consent evidence after catalogue
reads. Existing E2E uses the real all-draft registry and checks direct URLs/SEO.

## Publication dependencies

See `legal-publication-blockers.md` and `legal-url-contract.md`. Required next
steps: independent integration of PR #46; fresh-main sync/review; owner confirmation
of these URLs and production origin; approved source revision replacing all 16
URL placeholders with new immutable identities; legal/requisites/address/effective
date approval; security policy drafting-instruction removal approved by its owner;
working support/privacy/refund/disclosure operations; consent/age/re-consent and
checkout/dissemination flows; production DNS/TLS/mail/localization/tax review.
Readiness must not be flipped to make this UI appear populated.

Draft PR Policy is skipped by the existing workflow. Its current implementation
also rejects any non-main base; leave the PR Draft and retarget to main after the
parent integrates, then require a real Policy PASS. Do not change policy, mark the
stack ready or claim independent approval to work around this dependency.
