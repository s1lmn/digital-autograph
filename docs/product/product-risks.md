# Product risks — конкурентное дополнение EGO-68

Проверено 2026-10-05 (Europe/Moscow). Статус всех рисков: **open / exposure
не измерена**. Это initial input для [EGO-71](https://linear.app/egor-loshkarev/issue/EGO-71),
поскольку полного Risk Register в `docs/product` на baseline исследования нет.
Техническая реализация ограничения не доказывает приемлемость продуктового риска.
Owner ниже — предложенная ответственная роль, не новое назначение человеку.

Impact: high — угроза мотиву платить/повторять либо safe/legal launch;
medium — существенная потеря conversion/distribution. Вероятности не оценивались:
нет интервью/пилотных наблюдений. Priority — порядок discovery, не количественный
risk score. Все evidence references — [матрица A/S/D](competitive-landscape.json),
[выводы C](competitive-landscape.md), [гипотезы H](product-hypotheses.md).

## R68-01 — Пустая площадь без социальной ценности

- Impact **high**, priority **P0 discovery**, signal: Wall просматривают, но фанаты
  не могут объяснить, для кого хотят быть видны; оплата требует founder pitch.
- Evidence: A01/A11/A14/A20: действие связано с community/live/artist, не только
  местом; перенос на Wall — гипотеза, не доказательство причинности.
- Mitigation C01: creator-led Drop с реальной аудиторией/поводом, H01/H05.
- Proposed owner: product/creator lead; EGO-69/70/115/118.
- Close criterion: H01/H05 проходят согласованные критерии на независимой
  аудитории после safe launch; free claims сами по себе риск не закрывают.

## R68-02 — Пользователь покупает не ту услугу, которую ожидает

- Impact **high**, priority **P0**. Signal: «получу подпись знаменитости/ответ»,
  «владею местом навсегда», «смогу перепродать» после прочтения checkout.
- Evidence: A03/A04/A05 продают результат от таланта; D01 отличается принципиально.
- Mitigation C02: own autograph, срок, displacement/history перед оплатой; H02.
- Proposed owner: product/UX/legal; EGO-65/75/81/83/86.
- Close criterion: H02 в comprehension test; новая версия текста повторно проверяется.

## R68-03 — Вытеснение вызывает чувство потери и отказ возвращаться

- Impact **high**, priority **P0**. Signal: пользователь считает, что деньги
  «сгорели», не замечает history или воспринимает уведомление как вымогательство.
- Evidence: A13 хранит tenure, A06 membership не вытесняет; D02/D04 — наша гипотеза.
- Mitigation C03/C04: прозрачный cooldown, history и добровольный возврат; H04.
- Proposed owner: product/UX/community; EGO-65/67/81/119.
- Close criterion: H04 плюс разбор реального опыта displaced users после gated
  pilot; одна удачная платная retaliation не считается подтверждением.

## R68-04 — Бесплатное участие путают с willingness to pay

- Impact **high**, priority **P0**. Signal: высокая заполненность без добровольных
  takeover; revenue обеспечивают основатели, субсидии или один heavy spender.
- Evidence: A01 бесплатен, A09/A10 не требуют позиции; D02 не доказывает спрос.
- Mitigation C01/C06: отдельно unique independent payers, budget alternatives,
  концентрация и refunds; H05/H08. Не обнулять nonbuyers в отчёте.
- Proposed owner: product/analytics/finance; EGO-66/67/69/112/120.
- Close criterion: реальный accepted H05/H08 test; sandbox/опрос не закрывает риск.

## R68-05 — Creator income не покрывает effort и репутационный cost

- Impact **high**, priority **P0**. Signal: creator доволен gross, но отказывается
  от второго Drop после promotion/moderation/support.
- Evidence: A05/A06/A20 имеют другую операционную нагрузку; D05 не измерен.
- Mitigation C05/C06: diary времени, расходы, share и реальные возвраты; H06/H08.
- Proposed owner: creator lead/finance; EGO-70/76/78/115/119.
- Close criterion: повторное добровольное участие с документированным effort и
  согласованной выплатной схемой; earnings primitive не равно available payout.

## R68-06 — Денежная гонка и концентрация разрушают доверие

- Impact **high**, priority **P0 safety**. Signal: давление от loss alerts,
  попытки «отбить деньги», harassment, creator/друзья искусственно разгоняют цену.
- Evidence: A12 recognition monetization и A19 anti-bot policy; transfer risk
  выводится из нашей displacement/economy, frequency неизвестна.
- Mitigation C04/C08: без shame/ranking, видимый total cost, review концентрации,
  account abuse и связанных покупок; H04/H07. Anti-fraud отдельный EGO-108.
- Proposed owner: product/trust & safety; EGO-65/67/105/108/119.
- Close criterion: safety review и pilot с agreed stop rules; высокий gross
  не компенсирует incidents, risk остаётся наблюдаемым после запуска.

## R68-07 — Создание autograph не укладывается в Drop

- Impact **medium**, priority **P1**. Signal: аудитория ушла, пока upload,
  processing, approval или moderation ещё не закончены.
- Evidence: A08/A17 короткий переход от preview к доступу; наш evidence chain
  объективно отличается, slowdown пока не измерен.
- Mitigation C07: подготовка заранее, явные статусы/ожидания; H03, фиксировать
  moderation wait отдельно от interaction time; никаких safety bypass.
- Proposed owner: UX/operations; EGO-83/86/107/117.
- Close criterion: H03 на реальном flow и rehearsal, не только готовой fixture.

## R68-08 — Публичность подписи/имени дороже готовности делиться

- Impact **high**, priority **P0 privacy**. Signal: fan не различает original,
  cleaned image, public placement, alias и third-party share/cache.
- Evidence: A10 опциональная публичность, A13 privacy, A20 sharing rights; D07.
- Mitigation C08: private originals всегда; отдельные понятные publication/share
  решения, отказ не лишает базового участия; H07. Share PR #28 merged; реальный Telegram/social-client smoke ещё не подтверждён.
- Proposed owner: privacy/UX; EGO-74/75/94/110.
- Close criterion: H07 и privacy review; copied social cache нельзя обещать удалить.

## R68-09 — Ожидания экономики/прав copied из другой модели

- Impact **high**, priority **P0 before money**. Signal: тариф конкурента принят
  за нашу margin, price cap или creator payout без acquiring/tax/refund/support.
- Evidence: A09 direct money, A17 Stars, A18/A19 collectibles; D06 несовместим.
- Mitigation C06: [cost model](payment-economics.md), all-in inputs, одобренные
  seller/receipt/refund/share/payout contracts; H08. Платежи не включаются этим PR.
- Proposed owner: finance/legal/project owner; EGO-66/72/77/78/99/101/102/103/104/114.
- Close criterion: readiness gates и validated economics; выбор ЮKassa не закрывает
  receipts, refunds или production activation.

## R68-10 — Paid UGC и creator authenticity создают abuse surface

- Impact **high**, priority **P0 safety**. Signal: поддельный creator/endorsement,
  unsafe autograph, массовые accounts, misuse reports или inability to appeal.
- Evidence: A05 moderation, A12 paid chat removable, A19 anti-bot, A20 community
  policies; наличие политики не означает её эффективность.
- Mitigation C02/C08: подтверждение права creator на Wall, moderation derivative,
  reports/appeals, прозрачные финансовые последствия removal; H02/H07.
- Proposed owner: trust & safety/legal; EGO-76/105/107/108/102/114.
- Close criterion: agreed policies и end-to-end operational dry run до live pilot;
  оплаченный контент не исключён из правил.

## Обновление после исследования

Для EGO-71 перенести эти ID без перенумерации, добавить assignee, review date,
наблюдения и ссылки на decision. H01–H08 могут подтвердить проблему либо
уменьшить exposure; отсутствие данных не переводит риск в closed. EGO-68 не
назначает вероятность и не принимает launch/go-no-go решение вместо EGO-67/120.
