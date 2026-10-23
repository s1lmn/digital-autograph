# EGO-75 — URL contract (proposal, not publication approval)

Source target origin: `https://destka.ru`. Current deployment Caddy routes `WEB_DOMAIN` to Web and `API_DOMAIN` to API; neither domain nor Caddy/DNS is changed. Web has no legal/security pages yet. The existing API version route is implemented in this branch and tested fail-closed; all real source versions currently return no-store 404.

## Routes

| Purpose                                     | Contract                                                             | Owner/content                                       | Status / unapproved behavior                                                             |
| ------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Legal index                                 | `https://destka.ru/legal`                                            | Web, approved public metadata only                  | PROPOSED; no draft enumeration/body                                                      |
| Current terms_of_use                        | `https://destka.ru/legal/terms`                                      | Web resolves current approved registry identity     | PROPOSED; 404/unavailable without ready current version, no draft fallback               |
| Immutable version                           | `https://destka.ru/legal/terms/versions/{version}`                   | Web reads exact approved API bytes                  | PROPOSED; ready historical entries stay readable; no rewriting                           |
| Archive                                     | `https://destka.ru/legal/terms/archive`                              | Web lists approved retained versions                | PROPOSED; excludes never-published drafts                                                |
| Current community_guidelines                | `https://destka.ru/legal/content-rules`                              | Web resolves current approved registry identity     | PROPOSED; 404/unavailable without ready current version, no draft fallback               |
| Immutable version                           | `https://destka.ru/legal/content-rules/versions/{version}`           | Web reads exact approved API bytes                  | PROPOSED; ready historical entries stay readable; no rewriting                           |
| Archive                                     | `https://destka.ru/legal/content-rules/archive`                      | Web lists approved retained versions                | PROPOSED; excludes never-published drafts                                                |
| Current public_offer                        | `https://destka.ru/legal/offer`                                      | Web resolves current approved registry identity     | PROPOSED; 404/unavailable without ready current version, no draft fallback               |
| Immutable version                           | `https://destka.ru/legal/offer/versions/{version}`                   | Web reads exact approved API bytes                  | PROPOSED; ready historical entries stay readable; no rewriting                           |
| Archive                                     | `https://destka.ru/legal/offer/archive`                              | Web lists approved retained versions                | PROPOSED; excludes never-published drafts                                                |
| Current refund_policy                       | `https://destka.ru/legal/refunds`                                    | Web resolves current approved registry identity     | PROPOSED; 404/unavailable without ready current version, no draft fallback               |
| Immutable version                           | `https://destka.ru/legal/refunds/versions/{version}`                 | Web reads exact approved API bytes                  | PROPOSED; ready historical entries stay readable; no rewriting                           |
| Archive                                     | `https://destka.ru/legal/refunds/archive`                            | Web lists approved retained versions                | PROPOSED; excludes never-published drafts                                                |
| Current privacy_policy                      | `https://destka.ru/legal/privacy`                                    | Web resolves current approved registry identity     | PROPOSED; 404/unavailable without ready current version, no draft fallback               |
| Immutable version                           | `https://destka.ru/legal/privacy/versions/{version}`                 | Web reads exact approved API bytes                  | PROPOSED; ready historical entries stay readable; no rewriting                           |
| Archive                                     | `https://destka.ru/legal/privacy/archive`                            | Web lists approved retained versions                | PROPOSED; excludes never-published drafts                                                |
| Current personal_data_consent               | `https://destka.ru/legal/personal-data-consent`                      | Web resolves current approved registry identity     | PROPOSED; 404/unavailable without ready current version, no draft fallback               |
| Immutable version                           | `https://destka.ru/legal/personal-data-consent/versions/{version}`   | Web reads exact approved API bytes                  | PROPOSED; ready historical entries stay readable; no rewriting                           |
| Archive                                     | `https://destka.ru/legal/personal-data-consent/archive`              | Web lists approved retained versions                | PROPOSED; excludes never-published drafts                                                |
| Current personal_data_dissemination_consent | `https://destka.ru/legal/dissemination-consent`                      | Web resolves current approved registry identity     | PROPOSED; 404/unavailable without ready current version, no draft fallback               |
| Immutable version                           | `https://destka.ru/legal/dissemination-consent/versions/{version}`   | Web reads exact approved API bytes                  | PROPOSED; ready historical entries stay readable; no rewriting                           |
| Archive                                     | `https://destka.ru/legal/dissemination-consent/archive`              | Web lists approved retained versions                | PROPOSED; excludes never-published drafts                                                |
| Canonical API                               | `${API_PUBLIC_ORIGIN}/legal/documents/{type}/{version}`              | API, pinned `docs/legal/public` + registry          | IMPLEMENTED/TESTED; unknown/draft/placeholders 404, published current/history exact text |
| Personal state                              | `${API_PUBLIC_ORIGIN}/legal/state/{type}`                            | API, session-owned journal + registry               | IMPLEMENTED; metadata/latest own evidence, no draft canonical body                       |
| Security policy                             | `https://destka.ru/security`                                         | Web, separate approved security manifest/source     | PROPOSED; excludes consent and Order snapshots                                           |
| Security immutable/archive                  | `https://destka.ru/security/versions/{version}`, `/security/archive` | Web, separate retained source identities            | PROPOSED; no draft disclosure                                                            |
| Disclosure metadata                         | `https://destka.ru/.well-known/security.txt`                         | Web route, approved contact/policy + actual Expires | PROPOSED; no fabricated expiry/contact validation                                        |

The API origin comes from deployment configuration; a future `api.destka.ru` is not asserted as configured. Registry `path` remains API-relative; Web URL metadata must be introduced explicitly, without silently changing stored version/hash. A current page is an alias, never the immutable evidence identity. Future Web renderer must preserve canonical paragraph/literal numbering and escape text, never raw HTML.

## All 16 placeholder occurrences — approval table

No replacements have been performed. Every row remains WAITING FOR ROUTE IMPLEMENTATION/TEST + OWNER/LEGAL APPROVAL.

| #   | Source / paragraph start                                                | Placeholder                                   | Proposed replacement                                       |
| --- | ----------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| 1   | 01 / 1.11. «Правила размещения контента» — самостоятельный публичный д… | `[[URL ПРАВИЛ РАЗМЕЩЕНИЯ КОНТЕНТА]]`          | `https://destka.ru/legal/content-rules` (PROPOSED)         |
| 2   | 01 / 1.12. «Политика возвратов» — публичный документ Исполнителя, разъ… | `[[URL ПОЛИТИКИ ВОЗВРАТОВ]]`                  | `https://destka.ru/legal/refunds` (PROPOSED)               |
| 3   | 01 / 1.13. «Политика конфиденциальности» — документ Исполнителя об обр… | `[[URL ПОЛИТИКИ КОНФИДЕНЦИАЛЬНОСТИ]]`         | `https://destka.ru/legal/privacy` (PROPOSED)               |
| 4   | 01 / 1.14. «Пользовательское соглашение» — документ, регулирующий общи… | `[[URL ПОЛЬЗОВАТЕЛЬСКОГО СОГЛАШЕНИЯ]]`        | `https://destka.ru/legal/terms` (PROPOSED)                 |
| 5   | 01 / 5.12. Для денежных требований, в отношении которых законодательст… | `[[URL ПОЛИТИКИ ВОЗВРАТОВ]]`                  | `https://destka.ru/legal/refunds` (PROPOSED)               |
| 6   | 01 / Требования к пользовательскому контенту и порядок его модерации о… | `[[URL ПРАВИЛ РАЗМЕЩЕНИЯ КОНТЕНТА]]`          | `https://destka.ru/legal/content-rules` (PROPOSED)         |
| 7   | 02 / Платная услуга временного цифрового размещения контента посредств… | `[[URL ПУБЛИЧНОЙ ОФЕРТЫ]]`                    | `https://destka.ru/legal/offer` (PROPOSED)                 |
| 8   | 02 / «Правила размещения контента» — правила, устанавливающие требован… | `[[URL ПРАВИЛ РАЗМЕЩЕНИЯ КОНТЕНТА]]`          | `https://destka.ru/legal/content-rules` (PROPOSED)         |
| 9   | 02 / «Политика конфиденциальности» — документ, регулирующий обработку … | `[[URL ПОЛИТИКИ КОНФИДЕНЦИАЛЬНОСТИ]]`         | `https://destka.ru/legal/privacy` (PROPOSED)               |
| 10  | 02 / Пользователь обязуется соблюдать Правила размещения контента, дос… | `[[URL ПРАВИЛ РАЗМЕЩЕНИЯ КОНТЕНТА]]`          | `https://destka.ru/legal/content-rules` (PROPOSED)         |
| 11  | 02 / Правила размещения контента являются отдельным версионируемым док… | `[[URL АРХИВА ПРАВИЛ РАЗМЕЩЕНИЯ КОНТЕНТА]]`   | `https://destka.ru/legal/content-rules/archive` (PROPOSED) |
| 12  | 02 / Обработка персональных данных Пользователя осуществляется в соотв… | `[[URL ПОЛИТИКИ КОНФИДЕНЦИАЛЬНОСТИ]]`         | `https://destka.ru/legal/privacy` (PROPOSED)               |
| 13  | 02 / Предыдущие редакции Соглашения доступны в публичном архиве по адр… | `[[URL АРХИВА ПОЛЬЗОВАТЕЛЬСКОГО СОГЛАШЕНИЯ]]` | `https://destka.ru/legal/terms/archive` (PROPOSED)         |
| 14  | 02 / Публичная оферта — условия конкретной платной Услуги и Заказа; пр… | `[[URL ПОЛИТИКИ ВОЗВРАТОВ]]`                  | `https://destka.ru/legal/refunds` (PROPOSED)               |
| 15  | 03 / Предыдущие редакции доступны по адресу [[URL АРХИВА ПРАВИЛ РАЗМЕЩ… | `[[URL АРХИВА ПРАВИЛ РАЗМЕЩЕНИЯ КОНТЕНТА]]`   | `https://destka.ru/legal/content-rules/archive` (PROPOSED) |
| 16  | 04 / Предыдущие редакции доступны по адресу [[URL АРХИВА ПОЛИТИКИ ВОЗВ… | `[[URL АРХИВА ПОЛИТИКИ ВОЗВРАТОВ]]`           | `https://destka.ru/legal/refunds/archive` (PROPOSED)       |

## Publication and history invariants

Ready remains false. Actual URL completion changes canonical bytes and requires a new immutable technical identity/hash, reviewed source change proposal and operator/legal approval; it cannot overwrite `1.0` or `1.0-destka-20261010`. Old evidence and Order snapshots retain their original identity/hash. Once approved, historical ready versions stay readable independently of `current`. Retain canonical files, registry records, source manifests and conversion method. Never expose internal documents or source DOCX through API/Web.

Separate follow-up: implement and test these Web routes and approved version list, archive preservation/immutability CI, legal link/metadata display and actual security.txt workflow. This PR only prepares the contract and enforces public API withholding. No staging/production publication or deployment.
