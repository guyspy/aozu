import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { de } from './locales/de'
import { en, type Messages } from './locales/en'
import { es } from './locales/es'
import { fr } from './locales/fr'
import { ja } from './locales/ja'
import { ko } from './locales/ko'
import { ptBR } from './locales/pt-BR'
import { zhCN } from './locales/zh-CN'
import { zhTW } from './locales/zh-TW'

/** Shown in the header picker in each language's own name. English is the default and the fallback. */
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
] as const
export type LanguageCode = (typeof LANGUAGES)[number]['code']

const resources: Record<LanguageCode, { translation: Messages }> = {
  en: { translation: en },
  ja: { translation: ja },
  'zh-TW': { translation: zhTW },
  'zh-CN': { translation: zhCN },
  ko: { translation: ko },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  'pt-BR': { translation: ptBR },
}

const STORAGE_KEY = 'companion-language'
const isLanguage = (value: unknown): value is LanguageCode => LANGUAGES.some(({ code }) => code === value)
const storedLanguage = (): LanguageCode | undefined => {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    return isLanguage(stored) ? stored : undefined
  } catch { return undefined }
}

void i18n.use(initReactI18next).init({
  resources,
  lng: storedLanguage() ?? 'en',
  fallbackLng: 'en',
  supportedLngs: LANGUAGES.map(({ code }) => code),
  interpolation: { escapeValue: false },
})

// <html lang> drives per-language heading fonts and screen readers; the choice survives reloads.
const applyLanguage = (language: string) => {
  if (typeof document !== 'undefined') document.documentElement.lang = language
  try { globalThis.localStorage?.setItem(STORAGE_KEY, language) } catch { /* storage may be unavailable */ }
}
applyLanguage(i18n.resolvedLanguage ?? 'en')
i18n.on('languageChanged', applyLanguage)

export default i18n
