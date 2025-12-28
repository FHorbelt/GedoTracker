import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Settings } from 'lucide-react'
import { Button } from '../common/Button'

export function Header() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  
  const isHome = location.pathname === '/'
  
  const getTitle = () => {
    const path = location.pathname
    if (path === '/') return t('app.name')
    if (path === '/projects') return t('nav.projects')
    if (path === '/projects/new') return t('projects.new')
    if (path.includes('/projects/') && path.includes('/edit')) return t('projects.edit')
    if (path.includes('/projects/') && path.includes('/runs/new')) return t('runs.new')
    if (path.includes('/projects/') && path.includes('/runs/')) return t('runs.edit')
    if (path.includes('/projects/')) return t('projects.details')
    if (path === '/fixedpoints') return t('nav.fixedpoints')
    if (path === '/settings') return t('nav.settings')
    return t('app.name')
  }

  return (
    <header className="fixed top-0 left-0 right-0 bg-primary-700 text-white safe-area-top" style={{ zIndex: 9998 }}>
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            {!isHome && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => navigate(-1)}
                className="text-white hover:bg-primary-600 -ml-2 p-2"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
            )}
            <h1 className="text-lg font-semibold truncate">{getTitle()}</h1>
          </div>
          
          {isHome && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => navigate('/settings')}
              className="text-white hover:bg-primary-600 p-2"
            >
              <Settings className="w-5 h-5" />
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
