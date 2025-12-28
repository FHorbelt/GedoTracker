import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'
import { Home, FolderOpen, MapPin, Settings, Play } from 'lucide-react'
import { useActiveRun } from '../../contexts/ActiveRunContext'

export function BottomNav() {
  const { t } = useTranslation()
  const { activeRun, isRunActive } = useActiveRun()

  const navItems = [
    { to: '/', icon: Home, label: t('nav.dashboard') },
    { to: '/projects', icon: FolderOpen, label: t('nav.projects') },
    { to: '/fixedpoints', icon: MapPin, label: t('nav.fixedpoints') },
    { to: '/settings', icon: Settings, label: t('nav.settings') },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 safe-area-bottom" style={{ zIndex: 9999 }}>
      <div className="flex justify-around">
        {navItems.slice(0, 2).map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `
              flex flex-col items-center py-2 px-3 text-xs font-medium transition-colors min-w-0 flex-1
              ${isActive ? 'text-primary-600' : 'text-slate-500 hover:text-slate-700'}
            `}
          >
            {({ isActive }) => (
              <>
                <Icon className={`w-5 h-5 mb-1 ${isActive ? 'text-primary-600' : 'text-slate-400'}`} />
                <span className="truncate">{label}</span>
              </>
            )}
          </NavLink>
        ))}

        {isRunActive && activeRun && (
          <NavLink
            to={`/projects/${activeRun.projectId}/runs/${activeRun.runId}`}
            className={({ isActive }) => `
              flex flex-col items-center py-2 px-3 text-xs font-medium transition-colors min-w-0 flex-1
              ${isActive ? 'text-red-700' : 'text-red-600 hover:text-red-700'}
            `}
          >
            {({ isActive }) => (
              <>
                <Play className={`w-5 h-5 mb-1 ${isActive ? 'text-red-700' : 'text-red-500'}`} />
                <span className="truncate">Aktiver Run</span>
              </>
            )}
          </NavLink>
        )}

        {navItems.slice(2).map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `
              flex flex-col items-center py-2 px-3 text-xs font-medium transition-colors min-w-0 flex-1
              ${isActive ? 'text-primary-600' : 'text-slate-500 hover:text-slate-700'}
            `}
          >
            {({ isActive }) => (
              <>
                <Icon className={`w-5 h-5 mb-1 ${isActive ? 'text-primary-600' : 'text-slate-400'}`} />
                <span className="truncate">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
