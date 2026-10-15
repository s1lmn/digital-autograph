# EGO-88: аудит публичного репозитория — 15 октября 2026

Срез получен через GitHub API, Linear, Yandex Cloud CLI и ограниченные сетевые
пробы. VERIFIED означает проверенное наблюдение, BLOCKED — препятствие,
NOT RUN — проверка не выполнялась, REQUIRES OWNER ACTION — действие владельца.
Исторический успех не является доказательством текущей работоспособности.

## Дополнение после технического ревью PR #60

Исходные наблюдения ниже сохранены как срез аудита. Перед исправлениями повторно
проверены head #60 (без новых коммитов/reviews), Linear EGO-88 (**In Review**),
full ruleset и Actions policies (HTTP 200, пустой список с parents). Последний
подтверждённый CI #60 — 38761402396: все пять jobs PASS на исходном head.

В candidate JSON восстановлены оба отсутствовавших live review-параметра:
extra approval для unattributed changes=true и required_reviewers=[]. Новая
проверка требует весь review object, no bypass и остальные critical controls.
Draft Policy теперь fail-closed вместо skipped. Подготовлен exact-path Actions
event-policy payload, но GitHub settings не изменены. Риск enforcement с
2 ноября 2026 и непроверенный default-branch `policy` — **BLOCKED** для включения
required context. Локальные tests не заменяют реальную интеграционную проверку.

Точные ограничения, owner actions, поведение fork/draft/edited/synchronize,
модель CODEOWNERS и проверка после PUT: [activation runbook](pr-policy-activation.md).
Исправления готовятся в том же PR; новый exact-head CI/review отражаются в его
описании. EGO-88 не закрывается.

## VERIFIED: исходное состояние и зависимости

- Fresh `origin/main`: `6847339244f2a3fde89ef1f6b95965566f109668`.
  Visibility `public`, default branch `main`; исходное рабочее дерево чистое.
  Работа ведётся в отдельном worktree от этого SHA.
- Прочитаны AGENTS, README, CONTRIBUTING, архитектурные границы, ADR и
  deployment/runner/recovery runbooks; проект Linear и EGO-88/109/129/142/145/146.
  EGO-88 In Progress, EGO-109 Backlog, EGO-146 In Review; EGO-129/142/145 Done
  по текущему Linear. Их исторический статус не подтверждает здоровье сегодня.
- Открыты PR #43–45 (Actions), #46 (privacy), #47 (Secret Scan), #49 (Wall),
  #57 (reservation admission), draft #58/#59 (metrics/load), draft #55/#56
  (OAuth). Legal stack #54 → #53 → #52 → #46 остаётся draft до зависимостей.
  Ни один из этих PR не изменён и не слит данным аудитом.
- PR #47 head `96a998b6b97e2d6e816968d4cabba8c93471a65d`: merge-only scanning
  уже исправлен (`--all -m`), есть smoke и узкие исключения. Последний
  независимый review всё ещё CHANGES_REQUESTED на старом head; новый approval
  не обнаружен. Старый scanner и Actions updates не дублируются.

## VERIFIED / BLOCKED: GitHub Actions

Стандартные hosted runners публичных репозиториев не требуют оплаты минут;
переносить CI на self-hosted ради экономии не требуется. Storage/cache и larger
runners имеют отдельные ограничения. Источник:
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Actions enabled; allowed_actions=all, SHA pinning не требуется. Default token
read-only, Actions не может approve PR. Fork approval — только first-time
contributors. Это недостаточно для изоляции deployment runner.

Последний исходный CI [38638942527](https://github.com/s1lmn/digital-autograph/actions/runs/38638942527)
на PR #59: все пять jobs `checks`, `windows-unit`,
`windows-integration-runner`, `macos-integration-runner`, `e2e` завершены failure
без runner и без единого step. Annotation сообщает: recent account payments
have failed or spending limit needs to be increased. Аналогичное сообщение у
последнего PR Policy на #47. Это BLOCKED до нового успешного запуска после
смены visibility; платежные данные и время смены visibility через API не видны.

В последних 100 runs до этого PR: 64 success, 19 failure, 17 skipped.
Отдельные запросы queued/in_progress вернули 0; cancelled не обнаружены в
запрошенном срезе. Draft PR Policy закономерно skipped. Исторический успешный
CI #47 [38563392868](https://github.com/s1lmn/digital-autograph/actions/runs/38563392868)
действительно использовал стандартные Linux/Windows/macOS labels, но не
доказывает снятие сегодняшнего блокера. Новый exact-head результат этого PR
должен оцениваться отдельно в его checks.

## VERIFIED / REQUIRES OWNER ACTION: защита main

Обычная branch protection: HTTP 404 Branch not protected. Ruleset `24111688`
имеет enforcement=active, но `conditions.ref_name.include=[]`, exclude=[], а
`rules/branches/main` возвращает `[]`: фактически main правилом не защищён.
Внутри указаны неверные contexts `CI` и `PR policy`.

Реальные contexts из успешных runs: `checks`, `windows-unit`,
`windows-integration-runner`, `macos-integration-runner`, `e2e`, `policy`;
app GitHub Actions id 15368. `secrets` подтверждён отдельным успешным run
[38563392623](https://github.com/s1lmn/digital-autograph/actions/runs/38563392623).

Подготовлен `.github/security/main-ruleset.json`: main selector, no bypass,
PR + один независимый approval, dismiss stale reviews, resolved conversations,
strict CI, запрет force push/delete. Maintainer MDBaryshev имеет write,
s1lmn — admin, независимый reviewer существует. `secrets` нужно добавить после
интеграции #47 и успешного current-main scan. Draft и stacked PR не объявляются
готовыми к merge по skipped Policy. Конфигурация **не применена**; точные шаги
и совместимость описаны в [runbook](public-repository-security.md).

## VERIFIED: секреты и доступ публичного репозитория

- Pinned Gitleaks 8.24.3 Darwin arm64 скачан из официального release; SHA-256
  проверен по опубликованным checksums. Использованы scanner/config/smoke
  ровно из #47 вне рабочей ветки. Smoke: PASS, включая merge-only history,
  удалённые synthetic secrets, исключения, redaction и fail-closed guards.
- Полная доступная remote history: PASS на свежем non-shallow clone со всеми
  remote branches/tags (54 refs на момент клонирования), `--all -m`.
  Первый scan существующего локального checkout завершился ошибкой чтения Git
  tree object; его результат не засчитан как PASS. Новый полный clone прошёл.
  Непубликуемые локальные refs исходного checkout не сертифицированы.
- Отслеживаемая конфигурация содержит `.env.example` с локальными placeholders;
  `.env`, private keys, DB dumps и runtime secrets в tracked filenames не найдены.
  Отдельный поиск credential patterns не является доказательством отсутствия
  произвольных паролей, PII, бинарных данных или всех видов секретов.
- Выборочная проверка Gitleaks: логи последнего успешного main Release
  38054823725, успешного CI #47 38563392868 и Playwright artifact 11892654122:
  PASS, совпадений нет. Это три конкретных набора, **не** все исторические
  logs/artifacts (API сообщил 116 artifacts). Бинарное содержимое traces/screenshots
  и клиентские bundles полностью не аудировались.
- Реальные credentials/инцидент утечки не установлены. Значения findings не
  публиковались; история, ключи и Lockbox не менялись. Contributor attribution
  в Git и имена публичных maintainers не считаются application PII.
- GitHub secret scanning, push protection, private vulnerability reporting и
  Dependabot security updates disabled. Их включение требует owner action;
  состояние Dependabot alerts отдельно не подтверждено. Добавлены CODEOWNERS
  для security-sensitive paths и SECURITY.md без вымышленного SLA/contact.

## VERIFIED / BLOCKED: CI → Release

Workflow gate допускает automatic Release только после успешного CI push на
main из этого репозитория; PR и fork run отвергаются. Hosted prepare проверяет
manual main/actor/APPROVED/ancestry/exact-SHA CI/same-SHA staging, затем build и
deploy проверяют точный checkout. Release не скачивает artifacts и не
восстанавливает PR caches. Rollback использует записанный предыдущий image,
сохраняет volumes и не откатывает БД; существующие regression tests сохранены.

Yandex federation enabled, issuer token.actions.githubusercontent.com,
audience https://github.com/s1lmn; единственный обнаруженный publisher credential
привязан к immutable subject
`repo:s1lmn@210857445/digital-autograph@1389651843:ref:refs/heads/main`.
Это совпадает с GitHub OIDC customization API. На registry publisher имеет
images.pusher; VM identity — images.puller. У publisher не обнаружены bindings
на service account, folder и двух доступных clouds. Это не полный audit всех
возможных organization/resource grants. Live token exchange NOT RUN.

Release publisher не имеет Lockbox-доступа в workflow, runtime secrets
обрабатываются на VM. Теги SHA не перезаписываются самим workflow; серверная
immutability registry отдельно не доказана. Production environment отсутствует;
staging environment существует без protection, а deploy job не использует
`environment:`. Публичный GitHub Free поддерживает environment protections, но
текущая схема operator approval не менялась. Настройки Environment сами по себе
не включат approval для существующего job.

**BLOCKED: repository-level self-hosted runner не имеет проверенной изоляции от
изменённых/добавленных PR workflows.** Метки, read-only token и sudoers не являются
scheduler access control. Runner `da-staging-app` offline; production runner
не обнаружен. Не возвращать его online до отдельно одобренной изоляции.
Варианты и ограничения приведены в runbook. Одна только правка CI этот риск
не устраняет. Облачные ресурсы и runner registration не изменены.

## VERIFIED / BLOCKED / NOT RUN: staging

- A обоих доменов — `111.88.242.115`, AAAA отсутствует. Этот адрес совпадает с
  NAT IP VM `da-staging-app`; VM RUNNING, 2 cores/20%, 2 GiB RAM.
- Security Group разрешает inbound TCP 80/443 из 0.0.0.0/0 и outbound IPv4;
  SSH ограничен одним operator /32. Правила не изменялись.
- Из текущей среды TCP 80 и 443 соединяются. HTTP сбрасывает соединение,
  HTTPS обоих доменов завершается SSL connection timeout (bounded curl).
  Повтор без proxy также дал HTTP reset/TLS timeout. Сертификат не получен,
  его валидность NOT RUN. Нельзя утверждать, что причина — DNS или SG.
- Existing-key SSH с BatchMode/StrictHostKeyChecking дал reset при key exchange,
  гостевая сессия не открыта. Caddy, Docker service health, API/web loopback,
  actual image SHA, диски и ошибки после релиза: NOT RUN — нет guest access.
- Последний успешный GitHub Release
  [38054823725](https://github.com/s1lmn/digital-autograph/actions/runs/38054823725)
  от 10 октября: prepare/build_publish/deploy success; deployment 6981278358
  success для `6847339244f2a3fde89ef1f6b95965566f109668`. Это historical intended
  image SHA, а не доказанный работающий сейчас SHA.
- Root cause пока BLOCKED отсутствием guest evidence. Минимальные безопасные
  read-only действия владельца даны в runbook; restart, deploy, rollback, DNS,
  firewall, metadata/key bootstrap и нагрузочные тесты не выполнялись.

## Изменения и локальная проверка

CI: explicit contents-read, persist-credentials=false на всех checkout,
job timeouts, Playwright retention 3 дня. Все прежние jobs/команды сохранены.
PR Policy: trusted metadata-only pull_request_target, read-only token, без
checkout/PR code/secrets; поддержан рабочий branch prefix. Новые regression
checks проверяют границы доверия, метаданные и main ruleset.

Локальная среда: macOS arm64, Node 24.19.0, доступный pnpm 11.25.0;
CI по-прежнему использует project-pinned pnpm 11.19.0. Frozen install PASS.

| Проверка                           | Результат                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| pnpm format:check                  | PASS                                                                         |
| pnpm brand:check                   | PASS: 26 файлов, 20 contrast pairs                                           |
| pnpm lint                          | PASS                                                                         |
| pnpm typecheck                     | PASS                                                                         |
| pnpm security:audit                | PASS по existing High/Critical gate; 3 Moderate, 1 Low остаются              |
| pnpm test                          | PASS: 521 passed, 3 штатных Linux-only skips на macOS                        |
| pnpm build                         | PASS с .env.example, без реальных credentials                                |
| pnpm test:integration              | NOT RUN: Docker daemon недоступен; изолированные PostgreSQL/MinIO не подняты |
| pnpm test:build-smoke              | NOT RUN: требует изолированные PostgreSQL/MinIO                              |
| pnpm test:e2e                      | NOT RUN: требует изолированные PostgreSQL/MinIO и browser runtime            |
| pnpm test:runner-authorization     | NOT RUN: требуется Linux Docker container с sudo/visudo                      |
| pnpm test:migration-image          | NOT RUN: требуется Docker и чистый PostgreSQL                                |
| Linux/Windows jobs локально        | NOT RUN: локальная ОС macOS; оценивать новый hosted CI отдельно              |
| node scripts/smoke-safe-errors.mjs | PASS: safe startup failures API/worker без вывода canary                     |
| actionlint 1.7.12                  | PASS для всех трёх workflows; shellcheck отключён, отдельно не запускался    |

Первый build без .env не прошёл config validation; после установки только
публичных локальных placeholders из .env.example production build PASS.
Промежуточный новый ruleset test имел ошибку извлечения job names; она исправлена,
защита/production tests не ослаблялись. Полный build-smoke не подменяется отдельным
safe-error smoke. Реальный deploy/rollback: NOT RUN по прямому запрету задания.

## REQUIRES OWNER ACTION: порядок дальнейших действий

1. Проверить новое exact-head CI. При прежней billing annotation — Settings →
   Billing & licensing/Actions, account restrictions и GitHub Support; free
   public minutes не означают снятие failed-payment hold.
2. Независимый reviewer MDBaryshev должен проверить PR этого аудита. После
   подтверждения совместимости и отдельного согласия применить main ruleset,
   затем подтвердить эффективные правила через API. Не обходить review/CI.
3. Обеспечить enforceable deployment runner isolation до его включения;
   конфигурация требует отдельного review/owner approval.
4. Получить read-only guest diagnosis staging через существующий операторский
   канал. Только после установленной причины отдельно согласовать исправление.
5. Включить GitHub security features и all-external fork approval; завершить
   независимый review #47, после интеграции добавить required `secrets` check.
6. После стабилизации защиты — рассмотреть отдельный production Environment
   gate с тестированием OIDC/approval совместимости. Не менять рабочую схему
   в обход reviewed operational change.

Следующий независимый технический шаг: EGO-146 / PR #47 — проверить исправленный
merge-only scanner на текущем head, завершить independent review и интегрировать
через защищённый main после восстановления CI. Это немедленно закрывает дыру
публичной истории и даёт обязательный `secrets` context; продуктовые PR и
observability ниже по приоритету. Staging incident triage остаётся параллельным
operator blocker в пределах EGO-88/129/142, без переобъявления старых задач Done.
EGO-88/109 и другие родительские задачи этим аудитом не закрываются.
