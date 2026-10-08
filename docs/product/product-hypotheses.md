# Product hypotheses — EGO-68

Срез 2026-10-05 (Europe/Moscow). **Все гипотезы untested**. Ни one-click выбор,
ни намерение в интервью, ни sandbox payment не доказывают готовность платить.
Owners — предложенные роли. Числа ниже — **предлагаемые pre-registration
критерии**, не результаты, отраслевые benchmarks или утверждённые launch gates.
EGO-67 должен согласовать их до набора участников; после сбора не подгонять
thresholds. Малые выборки дают discovery signal, не population estimate.

Evidence: [аналоги A/D](competitive-landscape.json), [выводы C](competitive-landscape.md),
[risks R68](product-risks.md). Интервью и pilots относятся к EGO-69/70/86/118/119,
не выполняются и не закрываются этим research PR.

## H01 — Социальный контекст создаёт понятный мотив участия

- Claim: фанат хочет оставить след на событии узнаваемого автора, а не на
  обезличенной площади. Evidence C01, A01/A11/A14/A20; R68-01/04.
- Method: 12 взрослых фанатов минимум трёх creators; random order двух одинаковых
  по механике прототипов: contextual Drop и нейтральная Wall. Без оплаты и
  founder pitch; спрашивать мотив и выбор, включая «не участвовать».
- Measure: число людей из всех 12, самостоятельно назвавших audience/event motive
  и предпочитающих contextual вариант; отдельно order/creator cohort.
- Proposed criterion: ≥8/12 выбирают contextual и объясняют социальную ценность.
  Не считать визуальную симпатию мотивом платить. Отрицательный signal → менять
  creator/event offer до pricing; положительный → H05, не GO.
- Owner product research; EGO-69/70/81. Result: none.

## H02 — Услугу понимают без основателя

- Claim: до оплаты человек понимает, что подписывается сам, получает временную
  видимость после valid payment, может быть вытеснен после protection interval,
  history сохранит факт; личного ответа, resale и бессрочного места нет.
- Evidence C02/D01, A03/A04/A05; R68-02/10.
- Method: минимум 10 новых взрослых пользователей, unmoderated message +
  teach-back, сценарий paid placement → displacement → ended Wall.
- Measure: all six concepts, ошибки и подсказки на человека; denominator все 10,
  abandoned included. Proposed criterion: ≥9/10 объясняют все шесть без подсказки;
  **zero** сохраняют критичное ошибочное purchase expectation.
- Если критерии расходятся, critical error останавливает переход к paid test.
  Failure → переписать текст/пример, проверить новой выборкой; pass → usability,
  без изменения backend rules этим исследованием.
- Owner UX/product/legal; EGO-65/75/81/83/86. Result: none.

## H03 — Новый autograph успевает к событию без safety bypass

- Claim: fan проходит real signup/create/upload/processing/approval/moderation
  до подходящего claim window при предварительной подготовке.
- Evidence C07/D03, A08/A17; R68-07.
- Method: 10 новых взрослых пользователей на rehearsal с реальным consent и
  moderation; заранее согласованное окно подготовки. Не использовать ready
  fixture вместо создания. Не собирать originals в research-заметки.
- Measure: complete before window / все 10; interactive time и processing/moderation
  wait отдельно; шаг abandonment. Proposed criterion: ≥8/10 завершают без помощи
  и успевают; median interactive time ≤3 минуты (wait не скрывается в отчёте).
- Failure → улучшить preparation/status UX или длину rehearsal window; не отключать
  moderation. Pass не доказывает, что случайный live visitor успевает так же.
- Owner UX/operations; EGO-83/86/107/117. Result: none.

## H04 — History и protection делают displacement приемлемым

- Claim: потеря active места не воспринимается как исчезновение оплаченного
  результата; возвращение добровольно и не мотивировано необходимостью «отбить»
  траты. Evidence C03/C04/D04, A06/A13; R68-03/06.
- Method: 10 comprehension/usability sessions на сценарии прототипа, затем
  отдельный follow-up всех реально displaced users в gated pilot.
- Measure: нашли history / 10, корректно объяснили guarantee / 10, эмоции и
  free-return intent отдельно от pay-again intent. Proposed prototype criterion:
  ≥8/10 находят history за 30 секунд, ≥9/10 верно объясняют protection.
- Safety criterion: любые признаки financial pressure/loss-chasing требуют
  разбора до paid progression; pass usability не закрывает behavioral safety.
  Failure → текст/flow и, при необходимости, отдельное решение EGO-65; не усиливать
  push как лечение низкого возвращения.
- Owner product/community; EGO-65/67/86/119. Result: none.

## H05 — Takeover выбирают при наличии простых заменителей

- Claim: часть independent fans добровольно тратит реальный бюджет на временную
  видимость, имея choice tip/subscription/comment/no action.
- Evidence C01/C05/C06/D02, A07/A09/A11/A14; R68-01/04/06.
- Method: в интервью EGO-69 обсуждать последнюю реальную трату тому же автору;
  после **EGO-114 readiness** три последовательных pilot Drops разных creators,
  без возмещения платежей, покупки командой или скриптового «разгона».
- Denominator: unique eligible adult visitors, увидевшие понятное предложение,
  по каждому Drop и суммарно. Numerator: unique independent users с fulfilled
  paid takeover; исключения staff/связанные/тестовые заранее задать и отдельно
  показать, не удалять inconvenient nonbuyers. Provider success без fulfillment
  не purchase успех. Показывать raw counts, repeat payers, refunds и concentration.
- Proposed exploratory criterion: минимум 5 independent payers суммарно, хотя
  бы по одному в каждом Drop, без staff/subsidies; это не conversion target и
  не достаточный GO. При меньшей аудитории результат inconclusive; при достаточной
  agreed exposure и нуле спроса — iterate offer, не повышать price ladder.
- До запуска EGO-67 фиксирует minimum exposure, creator cohorts, stop rules,
  conversion и concentration gates; отсутствие их запрещает интерпретацию как GO.
- Owner product/analytics; EGO-67/69/112/118/120. Result: none.

## H06 — Автор хочет повторить Drop с приемлемой нагрузкой

- Claim: offer даёт net value creator без обязательства индивидуального ответа
  каждому участнику. Evidence C05/D05, A05/A06/A20; R68-05.
- Method: интервью ≥5 creators, rehearsal и diary трёх pilot creators; записать
  setup, promotion, explanation, support, moderation и репутационные concerns.
- Measure: фактическое время и согласованное acceptable effort каждого creator,
  willingness to schedule second Drop, expected vs actual earning **без обещания
  доступной выплаты** до finance readiness.
- Proposed criterion: ≥2/3 pilot creators выбирают второй Drop, укладываются в
  собственный заранее заявленный effort budget и понимают share/holds/payout
  условия. Interview intent отдельно; это не контрактное согласие.
- Failure → менять offer/support/share в соответствующих owner issues; не считать
  gross revenue достаточной выгодой.
- Owner creator lead/finance; EGO-70/76/78/115/117/119. Result: none.

## H07 — Участие и sharing совместимы с privacy/safety

- Claim: люди понимают публичность cleaned autograph/alias и могут отказаться
  от external share без давления; paid UGC не получает exemption от moderation.
- Evidence C04/C07/C08/D07, A10/A12/A13/A20; R68-06/08/10.
- Method: 10 новых взрослых пользователей, consent comprehension и report/appeal
  scenarios; sharing test только после merged/готового EGO-94. Не выдавать
  будущую функцию за доступную и не публиковать данные ради теста.
- Measure: correctly explain original-private/derivative-public/alias/share-cache
  concepts / 10; доля voluntary share отдельно, не считать отказ failure.
- Proposed criterion: ≥9/10 правильно объясняют все concepts, zero original
  exposure/unauthorized publication; report/appeal path и removal/refund policy
  должны быть согласованы до pilot. Consent confusion → revision/retest;
  любой privacy incident → остановить соответствующий сценарий и расследовать.
- Owner privacy/UX/trust & safety; EGO-74/75/94/105/107/110/102. Result: none.

## H08 — Full-cost экономика положительна без speculation и whales

- Claim: исполненный takeover даёт жизнеспособную contribution margin после
  acquiring, taxes, receipts, creator share, refunds/losses, infra, support и
  moderation, без resale дохода и субсидий. Evidence C06/D06; R68-04/05/09.
- Method: актуальные письменные terms + [cost model](payment-economics.md) и
  отдельный full-cost расчёт EGO-66; затем gated pilot observation. Основать base,
  downside и concentration sensitivity на реальных/одобренных inputs, не tariffs
  конкурентов. Unknown cost остаётся unknown, не zero.
- Measure: gross minus full variable costs, payout/settlement timing, fixed
  cost coverage при согласованном forecast; payer concentration и возвраты.
- Proposed criterion: base contribution >0; downside loss и concentration входят
  в **заранее согласованный** risk budget. Нет inputs/approval → inconclusive,
  не financial GO. Acquisition cost и break-even отдельно от per-payment margin.
- Failure → пересмотр offer/price/operations в EGO-66; не компенсировать loss
  скрытыми списаниями, валютой или выплатами вытесненному владельцу.
- Owner finance/product; EGO-66/67/77/99/101/102/103/104/120. Result: none.

## Как фиксировать результат

Каждой H добавить дату, sample/cohorts, consent basis, version прототипа/rules,
согласованные criteria, counts/denominators/exclusions, qualitative observations,
pass/fail/inconclusive, decision owner и next action. Для privacy не хранить
подписи/originals/личные платёжные данные в research-docs. До таких записей статус
остаётся untested. Полный decision dashboard — EGO-112, launch gates — EGO-67.
