# EGO-68 — Конкурентный разбор и карта заменителей

Дата проверки: **5 октября 2026, Europe/Moscow**. Автор исследования: Evgenii
(assignee Linear). Статус: результат desk research для review; принятие продуктовых
решений и результаты интервью/пилота отсутствуют.

## Вывод для MVP

Продавать нужно понятное участие в событии конкретного автора, а не абстрактную
площадь. Рабочая гипотеза: «Оставь свою подпись на Wall автора во время Drop;
текущее место может перейти другому участнику, факт участия останется в истории».
Это **подпись фаната**, не автограф знаменитости, не личный ответ, не инвестиция
и не бессрочное владение местом. Платный takeover пока нельзя считать доказанным
способом монетизации: substitutes уже дают поддержку, внимание или принадлежность
с меньшим числом действий и без вытеснения другого фаната.

Исследование предлагает проверить мотив «быть частью события» до оптимизации
price ladder. Значимость автора, реальная аудитория, понятный результат и
добровольное возвращение должны предшествовать созданию финансового давления.
Это вывод из различий механик, **не установленная причинная закономерность**.

## Контекст и границы

- [EGO-68](https://linear.app/egor-loshkarev/issue/EGO-68): 15–25 аналогов,
  девять измерений, минимум пять сильных заменителей, выводы для MVP,
  differentiators, риски и гипотезы; parent и жёстких blockers нет.
- EGO-64 `Done`: web-first, 18+, own autograph, free claim, paid takeover,
  history; без NFT, resale, выплат вытесненному владельцу, внутренней валюты,
  mobile apps и международных платежей.
- EGO-65 `In Progress`, EGO-66/67/69/70/71/81 в backlog: коммерческие параметры,
  unit economics, launch gates, интервью, общий Risk Register и позиционирование
  ещё не приняты. Этот документ передаёт им input, не закрывает их.
- GitHub после fetch: `origin/main` =
  `45a0e600563a8825bd0bebbae0a97fdf8d57d106`; EGO-97/98/100/94 уже merged.
  Sandbox payment orchestration есть; live readiness не следует из статуса Done.
  [PR #28 / EGO-94](https://github.com/s1lmn/digital-autograph/pull/28) merged.
  Notification/share-функции реализованы; реальный Telegram/social-client smoke
  и результаты retention/virality пока не подтверждены.
- В чате «Исправить PR #27 по EGO-94» EGO-68 ранее проверена как независимая
  исследовательская задача. Правила workflow подтверждены в CONTRIBUTING и
  Linear-документе «Парная разработка — инструкция разработчику и reviewer».
  Исследование выполняется от свежего main, отдельной веткой и PR.
- Источники истины продукта: [проект Linear](https://linear.app/egor-loshkarev/project/proekt-bez-nazvaniya-digital-autograph-platform-1501b5e0b8e4),
  [Wall domain](../architecture/wall-domain.md), [Free Claim](../architecture/free-claim.md),
  [pricing](../architecture/pricing.md), [reservation](../architecture/takeover-reservation.md),
  [payment orchestration](../architecture/payment-orchestration.md),
  [history](../architecture/placement-history.md), [acquiring decision](payment-provider-decision.md).
  Старые формулировки «payments ещё предстоят» в bootstrap-документах не отменяют
  актуальную merged-реализацию. Их общая редактура не входит в EGO-68.

## Как читать матрицу

[competitive-landscape.json](competitive-landscape.json) — переносимая матрица
20 аналогов, семи differentiators и 38 первичных источников. Для каждого аналога
есть audience, core loop, monetization, scarcity, retention, sharing,
creator incentive, moderation, onboarding, практическая рекомендация и ссылки.
Ключи A01–A20/S01–S38 связывают запись с источниками; C01–C08 — с выводами ниже.

Матрица включает независимые продукты и отдельные поведения внутри одной
платформы (Twitch Bits vs subscriptions; YouTube Super Chat vs memberships;
Telegram paid media vs gifts). Это **20 аналогов механизмов, 17 платформ**, а не
20 независимых конкурирующих компаний. Полного подтверждённого аналога сочетания
«own autograph + creator Wall + paid displacement + history» в этой выборке не
найдено; это не доказательство уникальности на всём рынке.

Все источники — официальные открытые страницы. Исходный срез — 5 октября;
при повторном review 8 октября S05 заменён текущей официальной product page:
прежний sign-types FAQ возвращает HTTP 404. Более широкие claims о fulfillment
из недоступного FAQ не считаются актуально подтверждёнными.
Исторические launch-посты Reddit/Telegram и Million Dollar Homepage не
представляются как описание действующего события 2026 года. Search snippets и
официальные страницы описывают заявленные функции, а не проверенный fulfillment.
Тарифы, GMV, conversion, retention, revenue share, эффективность модерации и
доступность платежей в РФ не измерялись. Рекламные claims не приняты за данные.
`Не установлено` означает нехватку подтверждения в указанном источнике, а не
отсутствие функции. Retention/sharing/incentive интерпретируются как возможные
механизмы, не измеренные эффекты. Просмотр без аккаунта не заменяет проверку
полного onboarding. Покупки, аккаунты, private data и интервью не использовались.

VK Donut рассматривался как локально релевантный кандидат, но воспроизводимый
официальный материал не получен; он не включён в подтверждённую матрицу. Наличие
Boosty/DonationAlerts в выборке не подтверждает нашу платежную или правовую
готовность. Это качественная выборка по user jobs, а не полный market sizing.

## Карта сильных заменителей поведения

Сильный заменитель — вариант, который удовлетворяет тот же предполагаемый мотив
и отнимает время/бюджет того же фаната. Это **аналитическая оценка**; реальное
переключение между продуктами проверяется интервью EGO-69/70. Выделено 11
сильных вариантов, сгруппированных по пяти jobs:

1. **«Заметить меня на эфире»** — DonationAlerts (A11), Twitch Bits (A12),
   YouTube Super Chat (A14). Альтернатива takeover: заплатить в привычном чате,
   где уже собраны creator и аудитория. Проверить H01/H02/H05: видят ли Wall
   другие участники и ценна ли видимость без ответа. У Super Chat есть региональная
   eligibility; поведенческий аналог не гарантирует фактическую доступность
   конкретному человеку. [Источники: DA](https://www.donationalerts.com/help/statistics-and-info),
   [Twitch](https://help.twitch.tv/s/article/guide-to-cheering-with-bits?language=en_US),
   [YouTube](https://support.google.com/youtube/answer/9277801?hl=en).
2. **«Поддержать автора»** — Ko-fi (A09), Buy Me a Coffee (A10), Boosty (A07).
   Простая поддержка не требует выигрывать чужое место. Проверить H05/H08:
   зачем фанат выбирает takeover при равном бюджете и остаётся ли margin после
   полной стоимости исполнения. [Ko-fi](https://ko-fi.com/pricing),
   [Buy Me a Coffee](https://help.buymeacoffee.com/en/articles/10182730-what-is-buy-me-a-coffee-and-how-does-it-work),
   [Boosty](https://boosty.to/).
3. **«Принадлежать к своим и быть признанным»** — Patreon (A06), Twitch
   subscriptions (A13). Perks и tenure дают статус без потери текущей позиции.
   Проверить H04/H06: компенсирует ли history вытеснение, готов ли автор повторять
   Drop без разрушения community. [Patreon](https://support.patreon.com/hc/en-us/articles/203913709-Joining-a-creator-s-Patreon-as-a-paid-member),
   [Twitch](https://help.twitch.tv/s/article/support-subscriptions?language=en_US).
4. **«Получить личный памятный результат»** — Cameo (A05), Streamily (A03).
   Там результат создаёт знаменитость; у нас подписывается фанат. Проверить H02:
   сможет ли человек верно пересказать эту разницу без помощи основателя.
   [Cameo](https://www.cameo.com/), [Streamily product formats](https://streamily.com/warrenkole/44578).
5. **«Участвовать в общем событии»** — r/place (A01), а за пределами продуктовой
   матрицы — обычный бесплатный комментарий/фанарт в сообществе.
   r/place показывает возможность координации, не willingness to pay. Проверить
   H01/H03/H05: переносится ли радость бесплатного участия в желание приобрести
   временную видимость. [Reddit retrospective](https://redditinc.com/news/place-part-two).

Отдельно сравнивать с **ничего не делать**: фанат может посмотреть Drop,
не создавать подпись и не платить. Этот вариант обязателен в интервью; выбранный
paid option среди только платных альтернатив завысил бы оценку спроса.

## Почему «продажа места» может не работать без контекста

Это механизм возможного провала, не утверждение о доказанном крахе конкретных
компаний. У каждой причины — наблюдаемое отличие, риск и действие для MVP:

- **Нет зрителя — нет социального сигнала.** У live-поддержки есть эфир, у
  r/place — координирующиеся сообщества. У нового Wall может не быть ни одного.
  C01: пилотировать creator-led события с добровольным приглашением аудитории;
  измерять реальные просмотры и узнавание участников, а не заполненность.
- **Смешаны «автограф автора» и «мой след у автора».** Cameo/Streamily дают
  личный результат знаменитости; Wall этого не обещает. C02: показать own-signature
  пример и предмет услуги до входа/оплаты; сделать teach-back H02.
- **Проигрыш ощущается сильнее приобретения.** Покупатель получает временную
  позицию, затем может её потерять. History сохраняет факт, но не заменяет
  текущую видимость и не создаёт гарантию публичного изображения навсегда.
  C03: объяснить cooldown, переход в историю и конец Drop; оценить восприятие
  вытеснения H04, не менять правила по одному эмоциональному ответу.
- **Платёжное соперничество может отталкивать сообщество.** Donates/subscriptions
  позволяют поддерживать автора без прямого конфликта фанатов. C04: не строить
  shame notifications, денежный рейтинг и обещание «самого верного фаната»;
  различать добровольное повторное участие и реакцию на потерю.
- **У автора нет причины снова приглашать.** Экономическая выгода может
  исчезнуть после support/moderation/promotion effort и репутационной цены.
  C05: записывать время и вопросы автора, проверять желание второго Drop и
  соответствие общей community-стратегии, не только revenue первого события.
- **Избыточное трение до первого результата.** В привычном чате фанат уже
  залогинен; здесь нужны вход, создание, processing, owner approval и moderation.
  C07: заранее показать ожидаемый результат и предложить подготовить autograph
  до Drop. Не обходить проверки ради скорости.

Million Dollar Homepage — исторический пример конечной площади, не доказательство,
что постоянные продажи координат повторяемы. Даже его масштаб не является
контрольной группой для creator Wall: другой продукт, аудитория и эпоха.
[Историческая страница](https://milliondollarhomepage.com/).

## Differentiators и практические решения

Полная таблица — `differentiators` в [матрице](competitive-landscape.json),
интерактивно — в локальном Canvas. D01–D07 различают объект покупки, scarcity,
free entry, history, creator effort, finance и privacy. Это проверяемые отличия
модели; «лучше», «уникально», «высокий retention» и moat не доказаны.

- **C01 — Creator-led событие (D02/D05).** MVP-рекомендация: закрытый Drop с
  узнаваемым поводом и реальной аудиторией. Проверка H01; EGO-69/70/115/117/118.
- **C02 — Честный предмет услуги (D01).** До оплаты сказать: подпись пользователя,
  временное место, guarantee interval, возможное вытеснение, history; личный
  ответ/подпись creator не входят. Проверка H02; EGO-65/75/81/83.
- **C03 — History как память (D03/D04).** Развести active placement, completed
  history и final Wall. Не обещать бессрочную публичную картинку или автоматическое
  завершение lifecycle по таймеру. Проверка H04; EGO-65/83. Persisted history
  остаётся истиной, visibility зависит от lifecycle/privacy/moderation.
- **C04 — Добровольное возвращение (D02/D04).** Сначала подтвердить пользу
  возврата. Избегать давления, скрытого unlimited spend и унижения вытесненного
  участника. Проверка H04/H07; EGO-67/81/105. Notification consent и easy exit
  обязательны при готовности канала, реализация EGO-94 ещё на review.
- **C05 — Исполняемый creator offer (D01/D05).** Запуск, объяснение и поддержка
  события, без обязательства ответить каждому. Измерять полный effort и желание
  повторить. Проверка H06; EGO-70/76/78/115/119.
- **C06 — Собственная экономика (D06).** Не переносить комиссии, royalty,
  store fees и crypto incentives других платформ. Заполнить
  [cost model](payment-economics.md) актуальными коммерческими inputs; отдельно
  посчитать налоги, creator share, support/moderation и losses в EGO-66.
  Проверка H08, legal/runtime gates сохраняются.
- **C07 — Preview до регистрации, подготовка до Drop (D03).** Публичный просмотр
  Wall и понятный образ результата; один free claim на User/Wall не восстанавливается
  после displacement. Проверка H03/H07; EGO-69/83/86. Никакого нового free-claim
  правила или bypass moderation в этом PR.
- **C08 — Paid UGC остаётся UGC (D07).** Оплата не покупает exemption от policy.
  Original private; публикация только допустимого derivative; reporting/appeal
  и финансовое последствие removal нужны до live pilot. Проверка H07;
  EGO-105/107/110/102. Публичное имя и share — самостоятельные privacy decisions.

## Что нельзя копировать

1. **Free pixel war (r/place).** Там cost action — время; здесь реальные деньги,
   verified payment и protected visibility. Нельзя делать мгновенное повторное
   вытеснение или обходить PostgreSQL eligibility ради «динамики». C03/C06;
   EGO-65/66.
2. **Permanent ad ownership (Million Dollar Homepage).** Оно не равно временной
   услуги Wall. Не обещать бессрочное место или рекламный ROI. C02; EGO-75/81.
3. **Guaranteed celebrity response (Cameo/vShout/signing).** Требует индивидуальной
   работы и иной структуры fulfillment. Не ставить revenue ожидания этих услуг
   в наш average ticket. C02/C05; EGO-66/70.
4. **Direct-to-creator money (Ko-fi).** Наш accepted target — платформа-продавец
   и отдельное вознаграждение creator. Иные seller/payout/tax responsibilities;
   рекомендация не является юридическим заключением. C06; EGO-72/77/78.
5. **Recurring billing (memberships).** Не копировать автосписания как retention;
   это иной предмет услуги/consent и не scope MVP. C04/C05; EGO-64/75.
6. **Bits/Stars, crypto rewards, NFT and resale (Telegram/Top Shot).** Не нужны
   внутренняя валюта, random rarity, вторичная ликвидность, royalties или выплаты
   вытесненному владельцу. Они меняют экономику, abuse surface и compliance
   вопросы; границы EGO-64 запрещают их в MVP. C06/C08; EGO-72/108.
7. **Международные tariffs/eligibility/removed-message policies.** Комиссии и
   refund-правила другой страны/платформы не подходят российской услуге.
   Даже YouTube специально отделяет Super Chat от donations. Не называть наше
   checkout «благотворительным донатом» без принятой legal-модели.
   [YouTube policies](https://support.google.com/youtube/answer/9277801?hl=en).
   C02/C06/C08; EGO-72/75/77/99/102. Это product boundary, не вывод о применимости
   конкретной нормы права.

## Обновление рисков, гипотез и передача дальше

[product-risks.md](product-risks.md) содержит R68-01–R68-10: impact,
qualitative exposure, mitigation, owner role, evidence и связанные задачи.
Это начальное конкурентное дополнение для EGO-71, не подмена полного
межфункционального Risk Register. [product-hypotheses.md](product-hypotheses.md)
содержит H01–H08 с методами, denominators, предлагаемыми decision criteria и
реакцией на отрицательный результат. Все ещё untested.

Последовательность передачи: EGO-69/70 (интервью и motive/effort) → EGO-65/66/67
(правила, экономика, согласованные thresholds) → EGO-81/83/86 (message/flow и
usability) → EGO-114/117/118/119/120 (готовность, rehearsals, pilot и решение).
Не запускать реальные оплаты только ради проверки H05/H08: pilot gates должны
быть закрыты; sandbox money не является willingness-to-pay evidence.

Review EGO-68 проверяет полноту/прослеживаемость исследования, а не принимает
все предложенные thresholds или реализует соседние issues. После PR issue остаётся
`In Review` до независимого review/принятия по проектному workflow.

## Проверка Definition of Done

- 20 записей и 17 платформ; у всех девять измерений, источник и MVP recommendation.
- 11 аналитически сильных substitutes в пяти jobs, плюс free comment и no action
  как контрольные поведения; strength требует валидации, не рыночного процента.
- У C01–C08 есть механизм, конкретная рекомендация, H/R и downstream owner issue.
- Есть отдельный разбор social context, seven non-copyable boundaries,
  seven differentiators, ten risks и eight falsifiable hypotheses.
- Нет выдуманных рыночных метрик, назначенных тарифов, одобрения legal или
  утверждения «конкурент делает → нам надо». Источники и ограничения воспроизводимы.
