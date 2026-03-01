import { createContext } from 'react'
import type { Locale, MessageKey } from '../i18n/messages'

export interface TranslateParams {
  [key: string]: string | number
}

export interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: MessageKey, params?: TranslateParams) => string
}

export const I18nContext = createContext<I18nContextValue | null>(null)
