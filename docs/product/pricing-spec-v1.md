# Destka Pricing Spec v1 — решение владельца 27.10.2026

**Продуктовые параметры утверждены. Применение в production и публикация цены
не разрешены.** Это решение заменяет прежние pricing hypotheses для сумм,
шага, cap, защиты и процента creator. Юридическая/налоговая/merchant приёмка
и параметры decay не следуют из принятия этой сетки.

Версия подготовленного артефакта:
[destka-owner-2026-10-27-v1](destka-pricing-2026-10-27-v1.json).
Денежные поля в JSON — строки целых копеек; backend использует bigint.
Артефакт не загружается API при старте, не seed migration, не admin request и
не меняет текущие Wall/configs. Незавершённые параметры представлены null.

| Параметр                  | Утверждено                                                          |
| ------------------------- | ------------------------------------------------------------------- |
| Валюта / algorithm        | RUB / takeover_ladder_v1                                            |
| Старт / минимум           | 89 ₽ / 89 ₽ (8900 копеек)                                           |
| Шаг                       | +100 ₽ (10000 копеек) после каждого успешного takeover на всей Wall |
| Step size / dynamic limit | 1 / 49 increments                                                   |
| Максимум                  | 4 989 ₽ (498900 копеек)                                             |
| Защита                    | 900 секунд (15 минут)                                               |
| Доля creator              | 5000 bps = 50%; база ещё не согласована                             |
| Free Claim                | Бесплатно; существующие ограничения сохраняются                     |

Для count успешных takeover на Wall до следующей покупки, **без затухания**:

```text
priceMinor(count) = min(498900, 8900 + min(count,49) × 10000)
```

| Успешных takeover до quote | Следующая цена               |
| -------------------------- | ---------------------------- |
| 0 / 1 / 2 / 3 / 4          | 89 / 189 / 289 / 389 / 489 ₽ |
| 48                         | 4 889 ₽                      |
| 49 и больше                | 4 989 ₽                      |

Цена 4 989 ₽ доступна для **50-й** успешной покупки: до неё произошло 49
успешных takeover. Quote/reservation/неуспешная попытка/отмена/Free Claim не
увеличивают count. При двух concurrent quotes цена не растёт сама по себе;
исполнение проверяет свежего target/ownership и reservation по существующему
платёжному протоколу. Один provider payment не может создать два takeover.

Защита измеряется backend от `Placement.startedAt`; до 900 секунд новый takeover
не допускается, начиная с границы 900 секунд — допускается при остальных
выполненных условиях. Текущий engine применяет этот config interval и к
Free Claim/admin Placements; бесплатность и claim eligibility этим не меняются.
Quote TTL и reservation TTL — отдельные инженерные сроки, не 15 минут защиты.

## Пока не согласовано

- Decay: interval/amount/floor. Нулевое затухание **не утверждено** как default.
- База 50% creator и корректировки при refund/chargeback. Нельзя считать
  `GMV × 0.5` принятым размером выплаты. Существующая earning арифметика runtime
  не становится утверждённой legal/financial policy этим решением.
- Итоговые merchant fees/settlement/limits, чеки/касса и accountant sign-off.
- Остальные финансовые лимиты, момент оказания услуги, consumer/refund rules,
  legal publication и конкретный production rollout.

Поэтому подготовленный JSON пока намеренно не является валидным полным
`createPricingConfigBody`: нельзя превратить null в 0/удобный interval и отправить
в admin API. После решения decay — новая полная immutable config, review и
отдельное разрешение применения. `PAYMENT_CREATOR_SHARE_BPS=5000` подготовлен
как будущий параметр, но env/Lockbox/runtime не менялись.
Существующие Wall сохраняют pin; историю/quotes/Orders не перепривязывать.

## Проверка и финансовая модель

`pnpm pricing:plan` строит офлайн матрицу 5/10/20 Slots × 10/30/100 takeover через
тот же domain `calculateTakeoverPrice`. Это явно отмеченный сценарий **без
затухания**, без моделирования реального спроса/времени; служебные neutral decay
поля существуют только в simulation/test helper и не экспортируются как
runtime config. Margin/creator payout остаются null, пока нет нужных условий.

До fees/refunds/tax/share и без decay:

| Takeover на Wall                      | GMV       | Средний чек |
| ------------------------------------- | --------- | ----------- |
| 10 (conservative activity hypothesis) | 5 390 ₽   | 539 ₽       |
| 30 (base activity hypothesis)         | 46 170 ₽  | 1 539 ₽     |
| 100 (aggressive activity hypothesis)  | 376 400 ₽ | 3 764 ₽     |

Число Slots не умножает GMV: takeover count уже общий по Wall. Эти activity
scenarios не являются forecast и не обещают число продаж. Refund sensitivity
1/3/5% — исследовательское допущение о возвращаемом principal, не условия
возврата покупателю. Процент creator известен, сумма без базы не рассчитывается.
[Acquiring cost model](payment-economics.md) сохраняет неизвестные комиссии
незаполненными; её синтетические regression examples не заменяют эти цены.

Проверки: domain ladder/boundaries/cap; real PostgreSQL quote на другом Slot
Wall, concurrent quotes и запрет client price;900-second protection;
RU/EN checkout показывает полученные серверные 89/189/4989 ₽ и 900 секунд.
Тесты не публикуют цену и не включают платежи. Adversarial legacy fixtures
сохраняются для проверки алгоритма, но не считаются коммерческой конфигурацией.
