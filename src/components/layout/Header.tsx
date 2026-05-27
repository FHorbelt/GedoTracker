import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Settings } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'

export function Header() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const isSettings = location.pathname === '/settings' || location.pathname.startsWith('/settings/')

  const getTitle = () => {
    const path = location.pathname
    if (path === '/') return t('app.name')
    if (path === '/projects') return t('nav.projects')
    if (path === '/projects/new') return t('projects.new')
    // Job routes
    if (path.includes('/jobs/new')) return t('measurementJob.new')
    if (path.includes('/jobs/') && path.includes('/edit')) return t('measurementJob.edit')
    // Run routes
    if (path.includes('/runs/new')) return t('runs.new')
    if (path.includes('/runs/') && path.includes('/edit')) return t('runs.edit')
    if (path.includes('/runs/')) return t('runs.title')
    // Job detail (has /jobs/ but not /runs/)
    if (path.includes('/jobs/')) return t('measurementJob.runs')
    // Project edit
    if (path.includes('/projects/') && path.includes('/edit')) return t('projects.edit')
    // Project detail (just /projects/:id) - show "Jobs"
    if (path.includes('/projects/')) return t('measurementJob.jobs')
    if (path === '/fixedpoints') return t('nav.fixedpoints')
    if (path === '/settings/employees') return t('settings.employees')
    if (path === '/settings/mx9-calibration') return t('settings.mx9Calibration')
    if (path === '/settings') return t('nav.settings')
    return t('app.name')
  }

  const headerStyle: React.CSSProperties = isDark
    ? {
        zIndex: 9998,
        backgroundColor: '#000000',
        borderBottom: '2px solid #3b82f6',
        color: '#3b82f6'
      }
    : {
        zIndex: 9998,
        backgroundColor: '#1e40af',
        color: 'white'
      }

  const buttonColor = isDark ? '#3b82f6' : 'white'

  return (
    <header
      className="fixed top-0 left-0 right-0 safe-area-top"
      style={headerStyle}
    >
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            {isSettings && (
              <button
                onClick={() => navigate(-1)}
                className="-ml-2 p-2 rounded-lg"
                style={{ color: buttonColor }}
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            {!isSettings && <img src="/icons/favicon.png" alt="" className="w-7 h-7 rounded" />}
            <h1 className="text-lg font-semibold truncate">{getTitle()}</h1>
          </div>

          {isSettings ? (
            <img src="/icons/favicon.png" alt="" className="w-7 h-7 rounded" />
          ) : (
            <button
              onClick={() => navigate('/settings')}
              className="p-2 rounded-lg"
              style={{ color: buttonColor }}
            >
              <Settings className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
