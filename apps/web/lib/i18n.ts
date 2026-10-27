import { messages } from './messages';

export type Locale = 'ru' | 'en';
export type TranslationValues = Record<string, string | number>;
export type Translator = (source: string, values?: TranslationValues) => string;
export const localeCookie = 'destka-locale';
export function parseLocale(value: unknown): Locale {
  return value === 'en' ? 'en' : 'ru';
}
const reverse = Object.fromEntries(
  Object.entries(messages).map(([en, ru]) => [ru, en]),
);

const patterns = Object.entries(messages)
  .filter(([key]) => key.includes('{'))
  .map(([en, ru]) => {
    const names: string[] = [];
    const escaped = en.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    const expression = escaped.replace(/\{(\w+)\}/g, (_, name: string) => {
      names.push(name);
      return '(.+?)';
    });
    return { en, ru, names, expression: new RegExp(`^${expression}$`) };
  });
function interpolate(text: string, values: TranslationValues = {}) {
  return text.replace(/\{(\w+)\}/g, (token, key: string) =>
    values[key] === undefined ? token : String(values[key]),
  );
}
export function translate(
  source: string,
  locale: Locale,
  values?: TranslationValues,
): string {
  const text = source.trim();
  const catalog = locale === 'ru' ? messages : reverse;
  const translated = Object.hasOwn(catalog, text) ? catalog[text] : undefined;
  if (translated)
    return source.replace(text, () => interpolate(translated, values));
  if (values) return interpolate(source, values);
  if (locale === 'ru') {
    for (const pattern of patterns) {
      const match = pattern.expression.exec(text);
      if (match)
        return source.replace(text, () =>
          interpolate(
            pattern.ru,
            Object.fromEntries(
              pattern.names.map((name, i) => [name, match[i + 1]!]),
            ),
          ),
        );
    }
  }
  return source;
}
