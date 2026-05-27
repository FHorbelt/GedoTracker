import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface ActiveRunInfo {
  projectId: string
  jobId: string
  runId: string
  runName: string
}

interface ActiveRunContextType {
  activeRun: ActiveRunInfo | null
  setActiveRun: (run: ActiveRunInfo) => void
  clearActiveRun: () => void
  isRunActive: boolean
}

const ActiveRunContext = createContext<ActiveRunContextType | undefined>(undefined)

const STORAGE_KEY = 'mmc-active-run'

export function ActiveRunProvider({ children }: { children: ReactNode }) {
  const [activeRun, setActiveRunState] = useState<ActiveRunInfo | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        return JSON.parse(stored)
      } catch {
        return null
      }
    }
    return null
  })

  useEffect(() => {
    if (activeRun) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(activeRun))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [activeRun])

  const setActiveRun = (run: ActiveRunInfo) => {
    setActiveRunState(run)
  }

  const clearActiveRun = () => {
    setActiveRunState(null)
  }

  return (
    <ActiveRunContext.Provider value={{
      activeRun,
      setActiveRun,
      clearActiveRun,
      isRunActive: activeRun !== null
    }}>
      {children}
    </ActiveRunContext.Provider>
  )
}

export function useActiveRun() {
  const context = useContext(ActiveRunContext)
  if (context === undefined) {
    throw new Error('useActiveRun must be used within an ActiveRunProvider')
  }
  return context
}
