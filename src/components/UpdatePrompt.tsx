import { useState, useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, X, ChevronDown, ChevronUp } from 'lucide-react'
import { APP_VERSION } from '../version'

interface VersionInfo {
  version: string
  notes: {
    de: { title: string; items: string[] }
    en: { title: string; items: string[] }
  }
}

export function UpdatePrompt() {
  const { t, i18n } = useTranslation()
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [showNotes, setShowNotes] = useState(false)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      console.log('SW Registered:', swUrl)
      // Check for updates every hour
      if (r) {
        setInterval(() => {
          r.update()
        }, 60 * 60 * 1000)
      }
    },
    onRegisterError(error) {
      console.log('SW registration error', error)
    },
  })

  // Fetch new version info when update is available
  useEffect(() => {
    if (!needRefresh) return

    fetch('/version.json', { cache: 'no-store' })
      .then(res => res.json())
      .then((data: VersionInfo) => setVersionInfo(data))
      .catch(() => {
        // Fallback if version.json doesn't exist yet
        setVersionInfo(null)
      })
  }, [needRefresh])

  const handleUpdate = () => {
    updateServiceWorker(true)
  }

  const handleDismiss = () => {
    setNeedRefresh(false)
  }

  if (!needRefresh) return null

  const lang = i18n.language?.startsWith('de') ? 'de' : 'en'
  const newVersion = versionInfo?.version
  const notes = versionInfo?.notes?.[lang]

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 animate-slide-up">
      <div
        className="rounded-lg shadow-lg p-4"
        style={{
          backgroundColor: 'var(--color-bg-card)',
          border: '2px solid #3b82f6'
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="p-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}
          >
            <RefreshCw className="w-5 h-5 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
              {t('update.title')}
            </h4>

            {/* Version info */}
            <div className="flex items-center gap-2 mt-1.5">
              <span
                className="text-xs px-2 py-0.5 rounded"
                style={{
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)'
                }}
              >
                v{APP_VERSION}
              </span>
              {newVersion && newVersion !== APP_VERSION && (
                <>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>→</span>
                  <span
                    className="text-xs px-2 py-0.5 rounded font-medium"
                    style={{
                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                      color: '#3b82f6',
                      border: '1px solid rgba(59, 130, 246, 0.3)'
                    }}
                  >
                    v{newVersion}
                  </span>
                </>
              )}
            </div>

            <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('update.backupHint')}
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0"
          >
            <X className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>

        {/* Release Notes toggle */}
        {notes && notes.items.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowNotes(!showNotes)}
              className="flex items-center gap-1.5 text-xs font-medium w-full"
              style={{ color: '#3b82f6' }}
            >
              {showNotes ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              {t('update.whatsNew') || (lang === 'de' ? 'Was ist neu?' : "What's new?")}
              {notes.title && (
                <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
                  — {notes.title}
                </span>
              )}
            </button>

            {showNotes && (
              <div
                className="mt-2 p-3 rounded-lg text-xs max-h-40 overflow-y-auto"
                style={{
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border)'
                }}
              >
                <ul className="space-y-1.5">
                  {notes.items.map((note, i) => (
                    <li key={i} className="flex gap-2" style={{ color: 'var(--color-text-secondary)' }}>
                      <span className="flex-shrink-0" style={{ color: '#3b82f6' }}>•</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-3">
          <button
            onClick={handleDismiss}
            className="flex-1 px-3 py-2 text-sm rounded-lg"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)'
            }}
          >
            {t('update.later')}
          </button>
          <button
            onClick={handleUpdate}
            className="flex-1 px-3 py-2 text-sm rounded-lg text-white font-medium"
            style={{ backgroundColor: '#3b82f6' }}
          >
            {t('update.now')}
          </button>
        </div>
      </div>
    </div>
  )
}
