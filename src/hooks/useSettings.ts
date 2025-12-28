import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { db } from '../db/database'
import { AppSettings } from '../db/models'

export function useSettings() {
  const { i18n } = useTranslation()

  const settings = useLiveQuery(() => 
    db.settings.get('app-settings')
  )

  const isLoading = settings === undefined

  const updateLanguage = async (language: 'de' | 'en') => {
    await db.settings.update('app-settings', { language })
    localStorage.setItem('language', language)
    i18n.changeLanguage(language)
  }

  const updateSettings = async (data: Partial<AppSettings>) => {
    await db.settings.update('app-settings', data)
  }

  return { 
    settings, 
    isLoading, 
    updateLanguage, 
    updateSettings,
    currentLanguage: settings?.language || 'de'
  }
}
