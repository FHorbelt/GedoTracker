import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './de.json'
import en from './en.json'

// Get saved language or default to German
const savedLanguage = localStorage.getItem('language') || 'de'

i18n
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: de },
      en: { translation: en }
    },
    lng: savedLanguage,
    fallbackLng: 'de',
    interpolation: {
      escapeValue: false
    }
  })

export default i18n
