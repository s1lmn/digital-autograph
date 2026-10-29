# Коммерческие решения Destka — 27.10.2026

Утверждённые владельцем продуктовые параметры: **старт/минимум 89 ₽,
+100 ₽ после каждого успешного takeover на всей Wall, cap 4989 ₽,
защита 900 секунд, creator 50%, RUB, Free Claim бесплатно**.
Это заменяет прежние записи об отсутствии выбора этих значений.
Публикация и применение в production по-прежнему не разрешены.

[Pricing Spec v1](pricing-spec-v1.md) и
[версионированный JSON](destka-pricing-2026-10-27-v1.json) содержат точные
minor units, формулу, границы и запрет активации неполного config.

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

## Оставшиеся решения владельца

| Пункт          | Известно                                                               | Ещё требуется                                                                                      |
| -------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Цена           | 8900/8900/498900 копеек; шаг 10000, step 1, limit 49                   | Decay interval/amount/floor; нулевой decay не принят                                               |
| Защита         | 900 секунд; существующий interval применяется также к Free Claim/admin | Согласовать offer/service wording и момент оказания                                                |
| Creator        | 50%, будущий PAYMENT_CREATOR_SHARE_BPS=5000                            | База, refund/chargeback adjustments, договор/payout/rounding                                       |
| Economics      | Численная ladder GMV matrix в Pricing Spec                             | Merchant fees/receipts, tax sign-off, infra/moderation, reserves; финальная margin пока неизвестна |
| Finance        | Backend/DB ограничения и incident admission controls                   | Реальные лимиты чека/дня/drop, fraud/manual review и stop criteria                                 |
| Refund/service | Продуктовая идея временного размещения                                 | Финальные сроки/условия услуги и возврата, moderation/сбой/окончание Wall; юрист                   |
| Production     | Конфиг подготовлен в репозитории                                       | Полный decay/config, CI/peer review, legal/fiscal/merchant gates и отдельное разрешение применения |

Conservative/base/aggressive теперь используют одну утверждённую ценовую
сетку и различаются гипотезами активности 10/30/100 takeover. Слоты 5/10/20 и
refund sensitivity1/3/5% остаются исследовательской матрицей, не тарифом или
forecast. Не менять долю 50% в этих сценариях без нового решения владельца.
Неподтверждённые расходы не заменяются нулями, creator base не подставляется.

Источники `docs/legal/public/*destka-20261010.md` уже содержат ФИО ИП, ИНН,
ОГРНИП, адрес и email. Требуются подтверждение актуальности, разрешение публикации,
согласованный телефон и работающие support/privacy/refund/abuse каналы.
Ничто не раскрывается через обход ready:false. Изменения legal текста — новые
immutable версии/hash, не переписывание истории.
