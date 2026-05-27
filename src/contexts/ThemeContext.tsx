import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { db } from '../db/database'

type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  isDark: boolean
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    // Try to get from localStorage first for immediate render
    const stored = localStorage.getItem('mmc-theme')
    return (stored as Theme) || 'light'
  })

  // Apply theme class to document
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('mmc-theme', theme)
  }, [theme])

  // Sync with database on mount
  useEffect(() => {
    async function loadThemeFromDB() {
      try {
        const settings = await db.settings.get('app-settings')
        if (settings?.theme) {
          setThemeState(settings.theme)
        }
      } catch (error) {
        console.error('Error loading theme from DB:', error)
      }
    }
    loadThemeFromDB()
  }, [])

  const setTheme = async (newTheme: Theme) => {
    setThemeState(newTheme)
    // Immediately apply to DOM
    const root = document.documentElement
    if (newTheme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('mmc-theme', newTheme)

    try {
      const existingSettings = await db.settings.get('app-settings')
      if (existingSettings) {
        await db.settings.update('app-settings', { theme: newTheme })
      } else {
        await db.settings.put({ id: 'app-settings', language: 'de', theme: newTheme })
      }
    } catch (error) {
      console.error('Error saving theme to DB:', error)
    }
  }

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }

  return (
    <ThemeContext.Provider value={{
      theme,
      setTheme,
      toggleTheme,
      isDark: theme === 'dark'
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
