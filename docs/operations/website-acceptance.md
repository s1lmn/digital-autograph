# Destka: воспроизводимая приёмка Website Ready

План от 29.10.2026 для EGO-93/148, EGO-99, EGO-109/110/111/113/129/134.
Подготовка не означает выполненную приёмку. A02/#78 ещё требует MDBaryshev review;
полный A03 начинается только после его protected merge и зелёного main.
Инфраструктура, OAuth, юридическая публикация и реальные платежи этим планом
не активируются. Исходный код и deployed staging имеют разные SHA.

## Повторяемая локальная база

Использовать принятый main SHA, Node24, pnpm11.19.0, отдельные loopback PostgreSQL
и private MinIO. В [E2E runbook](e2e.md#isolated-local-run) приведены точные
synthetic env и команды `infra:e2e:up` → `e2e:setup` → `test:e2e` → cleanup.
`e2e/environment.ts` запрещает staging/production/non-loopback fixtures; не
обходить guard. Создание test schema удаляет локальные E2E данные, поэтому
никогда не направлять setup на общий runtime. Сохранять traces приватно.

На этом SHA отдельно выполнить `test:integration` с `autograph_test`, `build`,
`test:build-smoke`, `test:recovery-drill`, E2E и применимые семь hosted checks.
В PR79 добавлен изолированный `test:ingress`; до merge команда доступна только
на его ветке. Не копировать непринятый код в main ради зелёного отчёта.
Проверки MinIO не подтверждают conditional writes/политику реального cloud bucket.

## Внешний core loop после отдельного разрешённого staging release

Предусловия: принятые A02/A03, A01 sign-off, конкретный release manifest/digests,
проверенные backup/rollback/alerts, разрешённые OAuth callbacks и тестовые аккаунты.
Никаких test-auth seams или прямого изменения SQL для прохождения внешнего flow.
Для consent, если enforcement включается, нужны отдельно утверждённые версии;
не подменять юридические тексты synthetic документами на публичном домене.

Записывать environment, source/image digests, время МСК, reviewer, устройство/
браузер/locale/theme, сценарий, ожидаемое и фактическое состояние, приватную
ссылку на доказательство и PASS/FAIL/BLOCKED. Не сохранять cookies, signed URLs,
provider tokens, оригиналы или персональные данные в публичном отчёте.

| Шаг        | Действие и ожидаемое доказательство                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creator    | Через существующий owner API создать разрешённый тестовый creator/Wall; зафиксировать реальные идентификаторы и owner permissions. Это не приёмка отсутствующего creator dashboard.                             |
| Wall       | Проверить draft/scheduled/live/ended и запрет действий в неверном состоянии; публичные Slots/счётчики совпадают с backend. Чужой owner не может управлять Wall.                                                 |
| Auth       | Войти через разрешённого provider, пройти возврат на исходную страницу, refresh/logout. Проверить cookie/Origin и отказ чужого/неавторизованного actor; OAuth fixture не заменяет реальный вход.                |
| Upload     | Рисунок и PNG/JPEG фото идут по credentialed API PUT после A02. Проверить 10MiB, chunked/+1, чужой owner, повтор/обрыв, срок и quota. Ошибка не создаёт object/placement; private original анонимно недоступен. |
| Processing | Дождаться реального worker и owner preview; проверить отказ/ограниченный retry и recovery. Uploaded не равен approved; pending/failed bytes не доступны публично.                                               |
| Moderation | Owner approval и разрешённое действие moderator проверяются отдельно; rejected/pending/чужой autograph не может занять Slot.                                                                                    |
| Free Claim | Пользователь занимает свободный Slot бесплатно; reload и два одновременных actor подтверждают одного победителя и одну active placement. Клиент не определяет eligibility/owner.                                |
| History    | Current Wall, личная и публичная history согласованы после claim/refresh. Нет утечки чужой private history, original key/URL; logout убирает приватное представление.                                           |

Один новый пользователь должен пройти всю цепочку, а не разные заранее
подготовленные DTO. Создание/публикация тестового контента на staging — только
в согласованном scope. Удаление тестовых данных — по утверждённой retention
процедуре, без удаления financial/audit/tombstone evidence.

Повторить RU/EN, light/dark, keyboard/focus, 320/390/768/1440px, 200% text,
физические mobile и Telegram/VK in-app. Проверить slow upload, потерю сети,
stale/conflict/expiry и восстановление. Синтетический Chromium — отдельная
инженерная база, не доказательство прохождения физических устройств.

## Будущий takeover checkout: fixtures отдельно от ЮKassa sandbox

Сейчас безопасно запускать локальные `yookassa.test.ts`, `payments.test.ts`,
`pricing.test.ts`, `takeover-reservation.test.ts`, `first-use.test.ts` и checkout
components. Unit transport подменён; PG/MinIO integrations проверяют настоящие
транзакции, но не живого провайдера. Реальная sandbox операция в этом checkpoint
не выполнена: test shop исторически подтверждён владельцем, но его текущая test
identity/доступ и безопасный runtime setup в этой сессии не проверены. Свежий
Lockbox metadata inventory показывает записи shop/key; payloads не читались,
наличие записи само по себе не доказывает test mode или работоспособность ключа.

После предоставления test-shop доступа и отдельного разрешения изменений staging:

1. Оператор подтверждает test shop и sandbox credential reference без публикации
   payload. Только `PAYMENT_MODE=sandbox`, provider `test=true`, фиксированный
   return URL и тестовый способ оплаты; live activation отсутствует. Префикс
   ключа сам по себе не подтверждает shop/mode. Не менять production env.
2. Получить Quote от backend и создать reservation существующим API. Сверить
   точные minor units, RUB, Order/shop/correlation, 900-секундную защиту и срок.
   Не передавать цену/owner из браузера. Утверждены 89 ₽ минимум/старт, +100 ₽
   за успешный Wall takeover, cap4989 ₽ и creator rate50%; decay и creator basis
   ещё не утверждены. Не выдавать no-decay fixture за production policy.
3. Проверить consent/evidence, hosted redirect, cancel, refresh/back, retry одной
   операции и stale Quote. Redirect/браузерный success не подтверждает оплату.
4. Через настоящий sandbox проверить authenticated status lookup, повторный и
   out-of-order webhook, response loss и reconciliation. Для ЮKassa не
   придумывать HMAC: следовать существующему provider boundary. Один payment
   исполняет максимум один Order, один Order создаёт максимум один takeover,
   Slot имеет максимум одну active placement.
5. При UNKNOWN не повторять списание новой операцией и не менять owner по
   предположению. Зафиксировать recovery и историю; запоздалый success после
   expiry разрешается существующей state machine. Receipt/refund/ledger/payout
   имеют отдельные DoD и не считаются готовыми по успешному sandbox capture.

## DNS/TLS/deployment/rollback: reviewable change set

До owner approval заполнить manifest: старые и предлагаемые DNS A/AAAA/CNAME,
TTL, registrar/zone owner, canonical web/API origins, CAA/ACME, certificate SAN,
release SHA/четыре image digests, совместимые migration IDs, private PG/bucket и
secret version references, backup/restore evidence и ответственные. Имена и
адреса production ресурсов нельзя выводить из staging или выдумывать.

Read-only baseline29.10: destka.ru — парковка, HTTPS www302→HTTP; staging
Web/live/ready200. Перед разрешённым изменением повторить authoritative и
внешние DNS ответы, TLS trust/expiry/SAN и expected product body. План должен
устранить HTTP downgrade, подтвердить cookie/CORS/OAuth callbacks и отсутствие
публичных DB/API bypass/object access. Проверить TLS до cutover разрешённым
способом; конкретную схему ACME и DNS изменения согласовать заранее.

Оператор исполняет только отдельно утверждённый manifest после A01 и security
review. Сохранить previous digests/config/DNS и назначить наблюдателя. Stop gates:
privacy leak, auth/core failure, migration/health failure, queue/DB saturation,
отсутствующий critical alert. Применить существующие incident controls; не
повторять финансовые операции и не удалять UNKNOWN/audit данные.

Rollback приложения — только совместимый cached digest; миграции автоматически
не откатывать. Schema forward-fix/restore из проверенного backup — отдельное
решение. После A02 сохранить attempts/tombstones, учесть старые upload capabilities
(600s плюс clock skew) и совместный rollout Web/API. DNS возврат учитывает TTL,
кэши и целостность данных; не направлять записи в две независимые active DB.
Отрепетировать release/rollback и проверить внешние flows после каждой операции.

## Незакрытые зависимости и раздельные gates

| Задачи       | Реальный остаток                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EGO-93/148   | Реальный staging core loop, физические mobile/in-app и визуальная приёмка владельцем; принятый дизайн не переделывать.                                                           |
| EGO-72/75/77 | Seller/service/creator legal model, утверждённые новые версии/контакты/URL, налогово-фискальная приёмка бухгалтером. 14 legal entries unready; публичную публикацию не включать. |
| EGO-99       | Website evidence, merchant onboarding/approval и подтверждённые fees/settlement/test-shop. Подготовленный checklist не равен approval ЮKassa.                                    |
| EGO-110      | Реальные consent/export/deletion/retention/backup exceptions; отдельно принять хранение upload tombstones.                                                                       |
| EGO-111      | Установленные monitoring/alerts/backups и фактическое восстановление; локальный drill не заменяет runtime acceptance.                                                            |
| EGO-113/129  | Representative workload/capacity, безопасный deployment/rollback и ingress на целевом runtime; green proxy smoke недостаточен.                                                   |
| EGO-134      | Reports/intake/cases/appeals/queue/actions/UI/audit/SLA ещё требуют реализации/приёмки; приняты только contracts/design.                                                         |

Source code ready требует reviews/merge/green main. Staging ready требует
безопасного воспроизводимого runtime и приёмки. Website ready требует внешнего
core loop, UX/legal/операционных gates. Merchant ready добавляет решение
провайдера/договор/комиссии. Paid pilot ready добавляет fiscal/refund/ledger/
creator payouts, финансовую приёмку и отдельное разрешение live pilot.
