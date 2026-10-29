# Destka.ru — фактическая готовность и критический путь

Дата: 27.10.2026. Read-only audit базы main
`5fc77c3ccb4464b880fa2b41d3c4f4036535b6c6`. Кроме отдельно разрешённого отсоединения runner21 (ниже), DNS/cloud/IAM/Release,
credentials, production DB, deployment, OAuth или live payments не изменялись.
Решения владельца и operational acceptance не заменяются этим документом.

## Актуализация 29.10.2026

Приняты PR81 (safe PostgreSQL diagnostics, reviewed head
`ccc38db85b1770e3aedc4d4549e9aeb3cf5e0f25`) и PR82 (private GET/body deadline,
reviewed head `3cbd5c6450c402e42e0242ddf2322355539dc3c9`). Approval выполнен
аккаунтом s1lmn с явной пометкой Codex-assisted; автор обоих PR — MDBaryshev.
Это review другим GitHub-аккаунтом, не заявление о ручной проверке человеком.
Main `90341e404aa87e10fc18626322bd5a30d7d743f5`: CI40855711719 и
Secret Scan40855711733 SUCCESS. Миграций в этих двух PR нет.

PR78–80 и PR83 остаются отдельными открытыми работами на этом main.
Объединение PR78/82 сохраняет bounded PUT/HEAD/delete и новый единый GET/body
budget; локально 339 real PostgreSQL/MinIO integration tests PASS.
В изолированной связке compiled API PR78 → pinned Caddy PR79 → private MinIO
проверены exact10MiB fixed/chunked, 400KiB/s (~26s), +1byte413 без объекта,
conditional412 без перезаписи, anonymous403, complete, stalled-body408 около30s,
unauthenticated401/foreign-Origin403 и ready200 после отказов.
Это локальная synthetic приёмка, не deployed staging/OAuth/physical mobile.

EGO-171 воспроизведён на pinned Gitleaks8.24.3: letters-only generic fixture
может попасть под встроенный allowlist. Отдельное исправление детерминированных
canaries не меняет правила/entropy/ignores/workflows. До protected merge и green
main задача не Done. A03 начинать только после принятия PR78 и нового green main.

Read-only повтор 29.10: repository runners=[]; Release disabled_manually.
Операторский отчёт 15:27:50 МСК в EGO-109/111/129/164 подтверждает отдельно
разрешённый минимальный host containment: старая exact runner service
disabled/inactive, da-runner исключён из Docker, два специальных sudoers grant
отозваны. Проверены реальные Docker/sudo denials, visudo и сохранность пяти
контейнеров. Это исправляет прежнюю запись «host не проверен», но не закрывает A01.
Metadata directory доступен из API container; runtime SA имеет staging Lockbox
grants. Effective inherited IAM/network, полная история и независимый security
review, новая trusted deployment identity остаются открытыми.
В ранее проверенном cloud folder staging VM RUNNING, Managed PostgreSQL clusters
отсутствовали; это исторический inventory folder, не новая проверка всего cloud.
Destka.ru всё ещё Reg.ru parking (A95.163.244.138); HTTPS www302 ведёт на HTTP.
Staging Web/API ready200 не подтверждают core flow или production topology.
Все14 legal entries ready:false;16 placeholders в4документах остаются.
Approved pricing JSON и pending financial decisions не менялись.

Свежий внешний HTTPS GET в продолжении после containment: staging Web/live/ready
200, TLS validation=0; destka.ru200 с парковкой, www302→http://destka.ru/.
Это не новая host/container/core-flow приёмка. По отчёту оператора deployed image
SHA `6847339244f2a3fde89ef1f6b95965566f109668`, а не source main90341e4.
Существующий SSH-recovery snapshot `fd80mukf0espctbvr53s` и root-only evidence
сохранить; snapshot продолжает тарифицироваться до отдельного решения владельца.
Не восстанавливать Docker/sudo старому runner и не ставить новый runner на прежнюю
VM. Инструкции старой topology/provisioning не являются разрешением отката containment.

В момент этой сверки все семь required contexts PR78/79/80/83 SUCCESS, reviews
пусты, MDBaryshev уже requested; mergeDecision REVIEW_REQUIRED. Авторская проверка
не заменяет независимое рассмотрение. При изменении head нужны новые checks и
review; после merge — green main CI/Secret Scan и normal main sync оставшихся PR.
Доступного независимого review в этой сессии пока нет; A03 не реализован.

В PR78 обновлён `docs/operations/runner-isolation-a01.md`: сохранён containment,
описаны proposed private deployment control, отдельные IAM identities и точный
workflow/ref allowlist. Это непринятый design, не созданные cloud/repository
resources. [План воспроизводимой приёмки](website-acceptance.md) разделяет
локальные fixtures, разрешённый внешний staging и будущий ЮKassa sandbox.

## Контрольная последовательность deployment и внешней приёмки

1. Принять PR78/79/80/83 через обычный review; после PR78 выполнить A03 от green
   main. После каждого merge повторять required checks оставшихся веток.
2. Закрыть A01 trusted-операторской проверкой и отдельными разрешёнными
   исправлениями. Зафиксировать новую deployment identity, границы Docker/sudo,
   metadata/IAM/network и историю jobs. Release до sign-off выключен.
3. Согласовать отдельную production VM/private Managed PostgreSQL, приватный
   bucket, environment-specific secret references и ожидаемую нагрузку.
   Записать inventory, бюджеты, monitoring/alert delivery, backup/PITR и результат
   восстановления в изолированную БД. Ничего не provision этим документом.
4. Подготовить конкретный release SHA и immutable image digests. Проверить
   миграции на clean DB и копии разрешённого snapshot; снять проверяемый backup.
   Для additive migrations0020/21 не удалять tombstones/attempt evidence при
   rollback. Откат приложения только к проверенному совместимому image digest;
   destructive schema rollback не выполнять, использовать reviewed forward fix.
5. После утверждённых контактов, юридических версий и финансовой конфигурации
   подготовить точный change set DNS/canonical HTTPS/Caddy/OAuth. Запросить
   отдельное разрешение владельца на этот change set и deployment; не включать
   реальные платежи как часть публикации сайта.
6. До изменения записать старые DNS/TTL/image digests/config references и
   критерии stop/rollback: privacy leak, broken auth/core, queue/DB saturation,
   migration error, health/alert failure. Сохранить финансовое UNKNOWN/evidence,
   остановить новые операции штатными incident controls; проверить совместимость
   предыдущего образа перед rollback. Отрепетировать и зафиксировать восстановление.
7. После разрешённого release независимый проверяющий фиксирует release SHA,
   DNS/TLS/canonical HTTPS/headers, анонимную недоступность originals и реальный
   auth→upload→worker→moderation→FreeClaim→history. Проверить RU/EN/themes,
   keyboard, mobile widths, реальные Telegram/VK in-app browsers, slow network,
   retry/conflict/expiry и sandbox paid path без списаний. При failed gate сайт
   не Website Ready; HTTP200 и synthetic CI не заменяют эту приёмку.
8. Только после Website Ready предоставить владельцу merchant dossier; реальный
   checkout/receipt/refund/payout и live pilot требуют отдельных согласований.

## История: отсоединение runner 27.10.2026 — 17:55 UTC

Владелец в этом чате явно разрешил **только отсоединение runner №21**.
Повторная проверка перед операцией: `da-staging-app`, online/idle, busy=false,
незавершённых workflow runs=0, соответствующих running/queued jobs=0.
GitHub `DELETE /repos/s1lmn/digital-autograph/actions/runners/21` вернул 204;
последующий список runners пуст. Release остался `disabled_manually`.
Staging Web и API health/live/ready отвечали 200 до и после удаления.

Это containment текущей регистрации, **не полный A01 acceptance**. Служба
на VM не останавливалась и не проверялась через operator console, cloud IAM,
metadata/network/sudo trust boundary и история возможных запусков не
пересматривались этой операцией. Новая безопасная deployment identity и
независимая security-проверка остаются обязательными; deployment не разрешён.
Это описание границы операции 27 октября. Минимальный host containment отдельно
разрешён и выполнен 29 октября, как указано в актуализации выше; его не откатывать.
Все дальнейшие действия на хосте/в cloud требуют нового разрешения владельца.
Таблица ниже сохраняет предшествующие read-only наблюдения; строка online
не описывает регистрацию после 17:55 UTC.

## Проверенные границы до containment

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

| Блокер / задача                     | Ответственный                          | Зависимость                                          | Проверяемое доказательство                                                                              | Следующий шаг                                                                                                                                                                                     |
| ----------------------------------- | -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A02 bounded upload, EGO-109         | Evgenii; независимый review MDBaryshev | Точный финальный head PR78                           | PG/S3 concurrency, chunked/10 MiB/auth/overwrite/quota/cleanup negatives, fresh checks + other approval | Review, normal protected merge, main CI/Secret Scan; parent 109 не Done                                                                                                                           |
| A03 storage I/O                     | Evgenii                                | Принятый A02 и fresh green main                      | Lease/fencing, короткие transactions, unknown commit/restart, finite PG/S3 deadlines и real races       | Отдельный PR по плану в PR78 `docs/architecture/autograph-io-next-stage.md`; не начинать stacked реализацию                                                                                       |
| A01 runner trust boundary           | Егор разрешает, Evgenii исполняет      | Конкретное разрешение infra/security changes         | Trusted workflow allowlist/изолированная deployment identity; effective metadata/IAM/network boundaries | Регистрация удалена, минимальный host containment выполнен; сохранить его, evidence и платный snapshot. Нужны новая identity, независимый security review и forensic acceptance; Release выключен |
| Core/security acceptance EGO-93/109 | Evgenii + Егор                         | A02/A03, legal/OAuth approvals для реальной проверки | Реальный auth→upload→worker→moderation→claim→history, failures/recovery                                 | После разрешённого безопасного staging; synthetic tests не закрывают physical gates                                                                                                               |
| Proxy/resource budget EGO-129/113   | Evgenii                                | Reviewed config и representative workload            | Размер/slow client limits, RSS/OOM, throughput, worker capacity                                         | [Source-only ingress PR79](https://github.com/s1lmn/digital-autograph/pull/79) независим от A02; capacity на согласованной инфраструктуре отдельно                                                |

## B. Website Ready

| Блокер / задача                  | Ответственный                                | Зависимость                                                      | Проверяемое доказательство                                                                                 | Следующий шаг                                                                                           |
| -------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Цена/условия EGO-65/66/97/98     | Егор / Evgenii                               | Решение владельца 27.10 и оставшиеся decay/financial/legal gates | Утверждены 89/+100/4989 ₽,900 секунд,50% rate; partial policy и offline model вPR80; production не менялся | Завершить decay и creator basis/refund/chargeback; review, затем отдельно разрешённый config rollout    |
| Legal EGO-72/75/77/110           | Егор + юрист/бухгалтер; инженер Evgenii      | Одобренная услуга/налоговая схема                                | Новые утверждённые версии/hash/URLs, реальные контакты и операционные каналы                               | Устранить 16 placeholders в 4 документах новыми версиями; `ready:false` не переключать без согласования |
| UX EGO-93/148                    | Егор / Evgenii                               | Принятый PR77 + реальный backend                                 | RU/EN, themes, widths, keyboard, auth return, in-app flows и субъективная приёмка                          | Проверять существующий дизайн; старый closed PR49 не открывать и redesign не начинать                   |
| IA/design/usability EGO-83/84/86 | Пока без assignee; назначает Егор            | Rules/consent и usable prototype                                 | Sitemap/state inventory, handoff и 8–10 реальных mobile sessions с findings/retest                         | Existing interview kit — только подготовка, не проведённое исследование                                 |
| Production infra EGO-88/111/129  | Егор / Evgenii                               | A01 + approved topology/budget                                   | Inventory частной PG/S3/secret refs, health, cookie/CORS, domain/TLS, restore/rollback, alert delivery     | Сначала доступный read-only inventory без payloads; действия только после отдельного разрешения         |
| Capacity EGO-113                 | Evgenii                                      | Согласованная ожидаемая нагрузка                                 | Representative mixed workload, processing memory/latency и ресурсный запас                                 | Локальный image benchmark не production capacity certificate                                            |
| Развёртывание/внешний smoke      | Егор разрешает; Evgenii + отдельный reviewer | Все security gates, цены/legal и конкретный release              | Release SHA, внешние HTTP/HTTPS и реальные core flows                                                      | Запросить разрешение на конкретные операторские действия после подготовки; сейчас deploy запрещён       |

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
