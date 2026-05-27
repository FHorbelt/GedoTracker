import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'
import { Home, Briefcase, MapPin, Play } from 'lucide-react'
import { useActiveRun } from '../../contexts/ActiveRunContext'
import { useTheme } from '../../contexts/ThemeContext'

export function BottomNav() {
  const { t } = useTranslation()
  const { activeRun, isRunActive } = useActiveRun()
  const location = useLocation()
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  // Check if we're on a run page
  const isOnRunPage = location.pathname.includes('/runs/')

  const navItems = [
    { to: '/', icon: Home, label: t('nav.dashboard') },
    { to: '/jobs', icon: Briefcase, label: t('nav.jobs') },
    { to: '/fixedpoints', icon: MapPin, label: t('nav.fixedpoints') },
  ]

  const navStyle: React.CSSProperties = isDark
    ? {
        zIndex: 9999,
        backgroundColor: '#000000',
        borderTop: '2px solid #3b82f6'
      }
    : {
        zIndex: 9999,
        backgroundColor: 'var(--color-bg-card)',
        borderTop: '1px solid var(--color-border)'
      }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 safe-area-bottom"
      style={navStyle}
    >
      <div className="flex justify-around">
        {navItems.map(({ to, icon: Icon, label }) => {
          const shouldBeActive = (isActive: boolean) => {
            if (to === '/jobs' && isOnRunPage) return false
            return isActive
          }

          return (
            <NavLink
              key={to}
              to={to}
              className="flex flex-col items-center py-2 px-3 text-xs font-medium transition-colors min-w-0 flex-1"
              style={({ isActive }) => ({
                color: shouldBeActive(isActive) ? '#3b82f6' : 'var(--color-text-muted)'
              })}
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className="w-5 h-5 mb-1"
                    style={{ color: shouldBeActive(isActive) ? '#3b82f6' : 'var(--color-text-muted)' }}
                  />
                  <span className="truncate">{label}</span>
                </>
              )}
            </NavLink>
          )
        })}

        {isRunActive && activeRun && (
          <NavLink
            to={`/projects/${activeRun.projectId}/jobs/${activeRun.jobId}/runs/${activeRun.runId}`}
            className="flex flex-col items-center py-2 px-3 text-xs font-medium transition-colors min-w-0 flex-1"
            style={{ color: '#ef4444' }}
          >
            <>
              <Play className="w-5 h-5 mb-1" style={{ color: '#ef4444' }} />
              <span className="truncate">Aktiver Run</span>
            </>
          </NavLink>
        )}
      </div>
    </nav>
  )
}
