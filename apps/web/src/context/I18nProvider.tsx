import { useMemo, useState, type ReactNode } from 'react';
import { I18nContext, type TranslateParams } from './i18n';
import { messages, type Locale, type MessageKey } from '../i18n/messages';

const LOCALE_STORAGE_KEY = 'finsentinel_locale';

function resolveInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored === 'en' || stored === 'zh') return stored;

  const browserLocale = navigator.language.toLowerCase();
  return browserLocale.startsWith('zh') ? 'zh' : 'en';
}

function translateText(template: string, params?: TranslateParams): string {
  if (!params) return template;

  return Object.entries(params).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    template,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(resolveInitialLocale);

  const setLocale = (nextLocale: Locale) => {
    setLocaleState(nextLocale);
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    }
  };

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: (key: MessageKey, params?: TranslateParams) => {
        const template = messages[locale][key] ?? messages.en[key];
        return translateText(template, params);
      },
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
