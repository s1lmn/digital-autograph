import { describe, expect, it } from 'vitest';
import { parseLocale, translate } from './i18n';

describe('interface translations', () => {
  it('defaults to Russian and accepts only a supported language', () => {
    expect(parseLocale(undefined)).toBe('ru');
    expect(parseLocale('en')).toBe('en');
    expect(parseLocale('ru')).toBe('ru');
    expect(parseLocale('<script>')).toBe('ru');
  });
  it('translates English and existing Russian UI copy in either direction', () => {
    expect(translate('Create autograph', 'ru')).toBe('Создать автограф');
    expect(translate('Create autograph', 'en')).toBe('Create autograph');
    expect(translate('Условия вашего заказа', 'en')).toBe('Your order terms');
    expect(translate('Условия вашего заказа', 'ru')).toBe(
      'Условия вашего заказа',
    );
    expect(translate(' Slot ', 'ru')).toBe(' Место ');
  });
  it('preserves creator names and literal replacement characters in dynamic headings', () => {
    const name = 'Your mark. $& <Studio>';
    expect(translate("{name}'s Wall", 'ru', { name })).toBe(`Стена ${name}`);
    expect(translate("{name}'s Wall", 'en', { name })).toBe(`${name}'s Wall`);
    expect(translate('Slot 12', 'ru')).toBe('Место 12');
    expect(translate('Digital autograph in slot 12', 'ru')).toBe(
      'Цифровой автограф на месте 12',
    );
  });
  it('localizes parameterized error/status copy without interpreting error codes', () => {
    expect(translate('Request failed (503). Please retry.', 'ru')).toBe(
      'Ошибка запроса (503). Повтори попытку.',
    );
    expect(translate('0h 2m 3s', 'ru')).toBe('0 ч 2 мин 3 с');
  });
  it('leaves unknown data and prototype-shaped strings untouched', () => {
    for (const source of [
      'Studio Notes',
      'constructor',
      'toString',
      '__proto__',
      'Непереведённый оригинал документа',
    ]) {
      expect(translate(source, 'ru')).toBe(source);
      expect(translate(source, 'en')).toBe(source);
    }
  });
});
