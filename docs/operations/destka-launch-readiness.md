# Destka.ru — фактическая готовность и критический путь

Дата: 27.10.2026. Read-only audit базы main
`5fc77c3ccb4464b880fa2b41d3c4f4036535b6c6`. Никакие DNS/cloud/IAM/runner/Release,
credentials, production DB, deployment, OAuth или live payments не изменялись.
Решения владельца и operational acceptance не заменяются этим документом.

## Проверенные границы

| Проверка                 | Наблюдение                                                                                                               | Что это доказывает / не доказывает                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| GitHub main              | 5fc77c3, CI/Secret Scan SUCCESS                                                                                          | Принят исходный код; не production readiness                                                                  |
| PR78 A02                 | OPEN, head 5cdfe6a5490caba99f0a1d41cd407e6a796e24b1: добавлен attempts race (338 integration PASS); fresh CI повторяется | Ожидает MDBaryshev; author verification не независимое approval. Старый head 35c51c5 имел семь checks SUCCESS |
| Runner                   | Repository runner 21 da-staging-app online/idle, Linux/X64, v2.338.0; Release disabled_manually                          | Label/main guard не ограничивает все PR workflows; A01 не закрыт                                              |
| DNS                      | destka.ru/www A 95.163.244.138, AAAA/CNAME отсутствуют в ответах                                                         | Одна точка наблюдения, не аудит cloud владения                                                                |
| HTTPS GET                | destka.ru 200, openresty, title destka.ru, текст парковки Рег.ру                                                         | Домен доступен, приложение Destka не опубликовано                                                             |
| www                      | HTTPS 302 → http://destka.ru/                                                                                            | Есть downgrade; требуется отдельное разрешённое исправление DNS/hosting                                       |
| TLS                      | Trust validation успешна, SAN destka.ru/www, notAfter 30.12.2026 15:59:04 UTC                                            | Сертификат парковки; не Caddy/Destka deployment                                                               |
| Cloud inventory          | В активном folder одна проектная VM da-staging-app RUNNING: 2 vCPU, 20%, 2 ГБ; Managed PostgreSQL clusters отсутствуют   | Это staging, отдельная production topology не подтверждена; folder не равен всему cloud                       |
| Storage/secrets metadata | Staging bucket anonymous read/list/config_read=false; da-staging-api и da-staging-worker ACTIVE в Lockbox                | Payloads не читались; full bucket policy/ACL/CORS и эффективные IAM-права не подтверждены                     |
| Staging external health  | staging.destka.online HTTP 200, title Digital Autograph Platform; API health/live и health/ready 200                     | Runtime отвечает с этой точки; точный release SHA и реальные пользовательские flows не проверены              |
| Network metadata         | Staging SG: public TCP80/443, SSH только один /32; общий outbound                                                        | Не доказывает изоляцию runner от untrusted PR или доступов к secret/DB                                        |
| Доступ к prod runtime    | SSH/runtime env/production DB/Lockbox payload не читались                                                                | Actual containers, backup/restore, alerts и capacity остаются непроверенными                                  |

Повторить DNS и `curl -I` перед изменениями; GET проверять на ожидаемый продукт,
а не только 200. Веб-инструмент второго внешнего наблюдения не открыл домен;
независимая внешняя приёмка реального приложения ещё не выполнена.

## A. Engineering Secure

| Блокер / задача                     | Ответственный                          | Зависимость                                          | Проверяемое доказательство                                                                                          | Следующий шаг                                                                                                                                      |
| ----------------------------------- | -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A02 bounded upload, EGO-109         | Evgenii; независимый review MDBaryshev | Точный финальный head PR78                           | PG/S3 concurrency, chunked/10 MiB/auth/overwrite/quota/cleanup negatives, fresh checks + other approval             | Review, normal protected merge, main CI/Secret Scan; parent 109 не Done                                                                            |
| A03 storage I/O                     | Evgenii                                | Принятый A02 и fresh green main                      | Lease/fencing, короткие transactions, unknown commit/restart, finite PG/S3 deadlines и real races                   | Отдельный PR по плану в PR78 `docs/architecture/autograph-io-next-stage.md`; не начинать stacked реализацию                                        |
| A01 runner trust boundary           | Егор разрешает, Evgenii исполняет      | Конкретное разрешение infra/security changes         | Trusted workflow allowlist/изолированная deployment identity; отсутствие пути untrusted PR к Docker/sudo/Lockbox/DB | По runbook в PR78 `docs/operations/runner-isolation-a01.md`; Release держать выключенным                                                           |
| Core/security acceptance EGO-93/109 | Evgenii + Егор                         | A02/A03, legal/OAuth approvals для реальной проверки | Реальный auth→upload→worker→moderation→claim→history, failures/recovery                                             | После разрешённого безопасного staging; synthetic tests не закрывают physical gates                                                                |
| Proxy/resource budget EGO-129/113   | Evgenii                                | Reviewed config и representative workload            | Размер/slow client limits, RSS/OOM, throughput, worker capacity                                                     | [Source-only ingress PR79](https://github.com/s1lmn/digital-autograph/pull/79) независим от A02; capacity на согласованной инфраструктуре отдельно |

## B. Website Ready

| Блокер / задача                  | Ответственный                                | Зависимость                                         | Проверяемое доказательство                                                                             | Следующий шаг                                                                                                  |
| -------------------------------- | -------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Цена/условия EGO-65/66/97/98     | Егор; 66 пока без assignee                   | Product/legal memo                                  | Принятый tariff/config ID и economics, server quote + expiry/disclosure                                | Заполнить [решения владельца](../product/commercial-owner-decisions.md); engine Done не значит tariff approved |
| Legal EGO-72/75/77/110           | Егор + юрист/бухгалтер; инженер Evgenii      | Одобренная услуга/налоговая схема                   | Новые утверждённые версии/hash/URLs, реальные контакты и операционные каналы                           | Устранить 16 placeholders в 4 документах новыми версиями; `ready:false` не переключать без согласования        |
| UX EGO-93/148                    | Егор / Evgenii                               | Принятый PR77 + реальный backend                    | RU/EN, themes, widths, keyboard, auth return, in-app flows и субъективная приёмка                      | Проверять существующий дизайн; старый closed PR49 не открывать и redesign не начинать                          |
| IA/design/usability EGO-83/84/86 | Пока без assignee; назначает Егор            | Rules/consent и usable prototype                    | Sitemap/state inventory, handoff и 8–10 реальных mobile sessions с findings/retest                     | Existing interview kit — только подготовка, не проведённое исследование                                        |
| Production infra EGO-88/111/129  | Егор / Evgenii                               | A01 + approved topology/budget                      | Inventory частной PG/S3/secret refs, health, cookie/CORS, domain/TLS, restore/rollback, alert delivery | Сначала доступный read-only inventory без payloads; действия только после отдельного разрешения                |
| Capacity EGO-113                 | Evgenii                                      | Согласованная ожидаемая нагрузка                    | Representative mixed workload, processing memory/latency и ресурсный запас                             | Локальный image benchmark не production capacity certificate                                                   |
| Развёртывание/внешний smoke      | Егор разрешает; Evgenii + отдельный reviewer | Все security gates, цены/legal и конкретный release | Release SHA, внешние HTTP/HTTPS и реальные core flows                                                  | Запросить разрешение на конкретные операторские действия после подготовки; сейчас deploy запрещён              |

## C. Merchant Ready

| Блокер / задача                                   | Ответственный                           | Зависимость                                          | Проверяемое доказательство                                                                       | Следующий шаг                                                                     |
| ------------------------------------------------- | --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Review сайта EGO-99                               | Егор + Evgenii                          | Website Ready                                        | [Merchant checklist](../product/merchant-review-readiness.md), реальные URLs и reviewer evidence | Убрать test content; подтвердить услуги/тариф/получение/offer/contacts            |
| Налоги/receipt/refund EGO-77/101/102              | Егор + бухгалтер/юрист, инженер Evgenii | Accepted model/contract                              | Fiscal config, payment/refund receipts + reconciliation, consumer support rules                  | Memo содержит АУСН 8%, но final sign-off/операционный контур ещё нужны            |
| Merchant/KYB EGO-99                               | Егор                                    | Готовый сайт, реквизиты, разрешение подачи           | Договор/approval, dated fee/settlement/limits, safe secret references                            | Подача владельцем в защищённом кабинете; этот audit не отправляет заявку          |
| Live finance / paid pilot EGO-100/101/102/103/104 | Егор разрешает; Evgenii исполняет       | Merchant approval, fiscal/refund/ledger/payout gates | Real controlled flows, UNKNOWN/idempotency/reconciliation, accounting approval                   | Sandbox можно проверять раньше. Live activation и pilot GO — отдельные разрешения |

## Core flows: доступные доказательства и оставшаяся приёмка

Существующие suites в `tests/integration` работают с реальными локальными
PostgreSQL/MinIO; UI suites могут использовать синтетические DTO. Ни один такой
прогон не подтверждает работу destka.ru или внешнего OAuth provider.

| Путь                                          | Где проверяется код                                                                                                               | Что ещё требует фактической приёмки                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Главная/creator/Wall, RU/EN/themes/responsive | `tests/e2e`, `apps/web/app/creators/[slug]/page.test.tsx`, `apps/web/app/walls/[id]/page.test.tsx`, `docs/design/verification.md` | Реальные creator/content, physical mobile/in-app, субъективный Егор acceptance |
| Auth/cookie/Origin/return                     | integration auth/Google/Telegram/Yandex/VK, web auth fixtures                                                                     | Разрешённые OAuth registration/redirects/consent и physical external login     |
| Upload/processing/approval/moderation         | integration autographs/autograph-processing/approval/moderation                                                                   | A02/A03 после merge, реальный private S3 и worker end-to-end                   |
| Free Claim/current owner/history              | integration free-claim/placement-history/public-wall-media                                                                        | Real deployed read/write и отсутствие stale owner после refresh/conflict       |
| Quote/cooldown/reservation                    | integration pricing/takeover-reservation, component/history fixtures                                                              | Утверждённые коммерческие значения и объяснение пользователю                   |
| Checkout/cancel/retry/stale/UNKNOWN           | integration payments/first-use/legal-evidence                                                                                     | Real sandbox provider + later approved fiscal/refund/live evidence             |

До внешней приёмки нельзя объявлять сайт работающим. Следующий инженерный
checkpoint: exact-head review PR78, не self-approval; после защищённого merge и
main checks — A03. Пока он ожидает review, допустимы независимые source-only
hardening/checklist изменения от main, без изменения production или publication.
