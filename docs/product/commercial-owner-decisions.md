# Цены и условия — таблица решений владельца / EGO-66

27.10.2026. Документ для согласования; не публичный тариф и не production config.
Значения из unit/E2E fixtures, bootstrap/demo и cost-model regression examples
не являются утверждёнными. Production DB не запрашивалась: отсутствие seed в
миграциях не доказывает отсутствие уже созданных оператором configs.

## Что уже известно

- Pricing Engine (EGO-97) и reservation (EGO-98) приняты. Версия
  `takeover_ladder_v1`, integer kopecks/RUB, immutable configs и quote snapshots.
  Migrations не создают коммерческий тариф; Wall без pin получает
  `PRICING_NOT_CONFIGURED`. Free Claim продолжает работать.
- [Legal Decision Memo v1](https://linear.app/egor-loshkarev/document/legal-decision-memo-v1-seller-of-record-paid-takeover-i-creator-09a159597c2f)
  выбирает платформу исполнителем собственной услуги, creator отдельным
  контрагентом. Финальная проверка юристом перед production остаётся обязательной.
- [Tax & Fiscalization Memo v0.1](https://linear.app/egor-loshkarev/document/tax-and-fiscalization-memo-v01-digital-autograph-mvp-2026-98a39d87670d)
  содержит сведения владельца от 03.10.2026: ИП, АУСН «Доходы» 8%,
  основной ОКВЭД 63.11.9, дополнительные 62.01/63.11/63.11.1/63.12.
  Это имеющиеся данные проекта, а не новая проверка регистрации/налогового статуса.
  Мемо всё ещё требует accountant/legal confirmation, receipt fields и версии policy.
- Выбраны ЮKassa primary / Т-Бизнес fallback. Sandbox shop и хранение test
  credentials в Lockbox ранее подтверждены владельцем; текущие payloads не читались.
  Merchant-specific fees, settlement и production approval не подтверждены.

## Решения до опубликования цены

Во всех строках нужен принятый документ с датой, ответственным и версией;
пустое поле нельзя заменить удобным тестовым значением. Егор — владелец решения,
Evgenii — исполнитель backend/config/UI после согласования.

| Параметр                    | Существующая техническая опора                                                  | Что должен утвердить владелец / зависимость                                                                               |
| --------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Стартовая цена              | `baseAmountMinor`                                                               | Реальный RUB-тариф, rationale, первые Wall; EGO-66                                                                        |
| Минимальная цена            | `minimumAmountMinor`, `decayFloorAmountMinor`                                   | Экономически допустимый минимум и floor после затухания                                                                   |
| Рост повторных takeover     | `takeoverStepSize`, `stepAmountMinor`, `dynamicTakeoverLimit`                   | Шаг и предел числа increments; count сейчас общий по Wall, не по Slot                                                     |
| Максимум                    | `maximumAmountMinor`                                                            | Cap и поведение после достижения                                                                                          |
| Затухание                   | `decayIntervalSeconds`, `decayAmountMinor`                                      | Период/величина, связь с последним успешным takeover                                                                      |
| Защита/cooldown             | `guaranteedVisibilitySeconds`                                                   | Срок защиты и точный оплачиваемый результат; EGO-65/72/75. Сейчас применяется также к Free Claim/admin Placement          |
| Истечение quote/reservation | Quote default 120s, bounds 30–300s; отдельный reservation TTL                   | UX подтверждения срока; инженерные defaults не становятся обещанием услуги                                                |
| Creator share               | `PAYMENT_CREATOR_SHARE_BPS`, earning snapshot                                   | Процент, база расчёта, refunds/chargeback adjustments, договор и допустимый payout; EGO-72/76/78/104                      |
| Финансовые лимиты           | DB/domain bounds и admission controls                                           | Лимит чека/дня/drop, fraud/manual review, reserves и stop criteria. BIGINT cap не коммерческий лимит                      |
| Оказание услуги             | Order → authenticated success → atomic takeover                                 | Когда начинается и заканчивается оплаченный период, конец Wall/сбой/модерация; единый текст offer/UI/receipt              |
| Возврат                     | UNKNOWN/manual-review safety уже есть; полноценный refund/fiscal flow ещё нужен | Отказ до/после начала, неоказание, partial service, вытеснение, dispute, сроки/канал; EGO-72/75/102 + юрист               |
| Налоги/чеки                 | Memo 03.10; EGO-77/101                                                          | Подтвердить актуальность АУСН, effective policy, номенклатуру, payment mode/subject, contact, VAT code, возврат/коррекцию |
| Acquiring                   | Конфигурируемый offline fee model                                               | Датированные условия именно merchant: методы, комиссии/НДС, refund fees, minimum/fixed fees, settlement/reserves          |

Нельзя перепривязать существующий Wall к другому non-null config. После выбора
создать новую immutable версию через разрешённый admin path, сохранить audit
согласования, pin/default по согласованному scope. Перед этим — отдельное
разрешение на изменение production DB. UI показывает серверную цену и её
объяснение; stale quote не оплачивается по цене, пересчитанной браузером.

## Conservative / base / aggressive — гипотезы, не тарифы

Неизвестным суммам оставлены символы: B (старт), F (минимум), M (cap), S (шаг),
G (защита), C (creator share), A (средний фактический чек). Ни B, ни C пока не
присвоено число. Финальную модель EGO-66 нельзя считать выполненной без этих входов.

| Гипотеза                             | Параметры для выбора, а не обещание                                                  | Данные для сравнения                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Conservative: низкая частота покупок | Мягкий ladder, меньший cap; повышенный refund/ops reserve; достаточно длинная защита | Меньше покупок, выше доля постоянных затрат на одну оплату; проверка отрицательной маржи |
| Base: ожидаемый опыт                 | B/F/M/S/G/C выбираются по интервью, договору и fee sheet                             | Наблюдаемые mix, конверсия и время до takeover, а не выдуманный forecast                 |
| Aggressive: более высокая активность | Более частый ladder/больше операций; cap и защита остаются ограниченными             | Capacity, число жалоб, refunds и концентрация выручки; рост GMV не равен прибыли         |

Общая матрица из EGO-66: 5/10/20 Slots × 10/30/100 takeover на drop;
refund sensitivity 1%/3%/5%. Эти числа — исследовательские сценарии, не
обещание 100 покупок и не настройка размера Wall. Дополнительно варьировать C,
цены, mix и частоту takeover; высокая активность не должна автоматически
повышать цену или сокращать защиту без отдельного решения.

Для каждого сценария:

```text
GMV = сумма реально смоделированных серверным ladder цен (не Slots × A)
retained = GMV - возвращённая основная сумма
creator = C × согласованная Qualifying Revenue base
contribution = retained - acquiring - receipts - creator - tax
               - disputes/fraud reserve - variable infra/moderation
result = contribution - fixed infrastructure/support/cash-register costs
```

Tax считается от подтверждённой бухгалтером налоговой базы. Memo по АУСН
«Доходы» не позволяет просто вычесть acquiring и creator share из базы;
refund recognition/timing согласуется отдельно. Не принимать опубликованную
ставку комиссии или пример fee model за merchant contract. Не учитывать повторно
возвращённый principal одновременно как lost revenue и отдельный расход.

[Текущая acquiring model](payment-economics.md) считает только payment-related
costs и не является полной unit economics. До численных выводов дополнить её
утверждёнными tax/share/infra/moderation assumptions и прогнать матрицу.
Порог минимального чека: contribution на оплату положителен и покрывает
согласованный reserve; stop criteria и target margin выбирает владелец.

## Контакты и содержание страниц

Источники `docs/legal/public/*destka-20261010.md` уже содержат ФИО ИП, ИНН,
ОГРНИП, адрес и email. Не требуется придумывать их заново; требуется подтвердить
актуальность, разрешение публикации и работу каналов. Согласованного телефона в
изученных источниках нет. Не дублировать персональные реквизиты в новых черновиках
и не раскрывать source через обход `ready:false`.

Нужно согласовать описание услуги/получения, offer/terms, privacy, content rules,
refund/payment rules, contacts/requisites и реальные canonical URLs.
Существующие legal routes и registry используются повторно; изменения
канонического текста оформляются новой immutable version/hash, не переписыванием
старого источника. Все 14 entries остаются unready до отдельного согласования.
