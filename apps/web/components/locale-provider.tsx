'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  localeCookie,
  translate,
  type Locale,
  type Translator,
  type TranslationValues,
} from '../lib/i18n';

type LocaleContext = {
  locale: Locale;
  t: Translator;
  setLocale: (locale: Locale) => void;
};
// Standalone component consumers retain their original text. The application
// always supplies an explicit server-selected locale through this provider.
const Context = createContext<LocaleContext>({
  locale: 'en',
  t: (text, values) =>
    text.replace(/\{(\w+)\}/g, (token, key: string) =>
      values?.[key] === undefined ? token : String(values[key]),
    ),
  setLocale: () => {},
});
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, updateLocale] = useState(initialLocale);
  const value = useMemo(
    () => ({
      locale,
      t: (text: string, values?: TranslationValues) =>
        translate(text, locale, values),
      setLocale: (next: Locale) => {
        updateLocale(next);
        document.cookie = `${localeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
      },
    }),
    [locale],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useLocale() {
  return useContext(Context);
}
