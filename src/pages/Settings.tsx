import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/layout/PageHeader'
import { Card, CardContent } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { Select } from '../components/common/Select'
import { Modal } from '../components/common/Modal'
import { useSettings } from '../hooks/useSettings'
import { db } from '../db/database'
import { BackupData } from '../db/models'
import { Download, Upload, Trash2, Info } from 'lucide-react'

export function Settings() {
  const { t, i18n } = useTranslation()
  const { settings, updateLanguage, updateSettings, currentLanguage } = useSettings()

  const [isCreatingBackup, setIsCreatingBackup] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showInfoModal, setShowInfoModal] = useState(false)

  const handleLanguageChange = async (language: 'de' | 'en') => {
    await updateLanguage(language)
  }

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true)

    try {
      const projects = await db.projects.toArray()
      const runs = await db.runs.toArray()
      const fixedPointFields = await db.fixedPointFields.toArray()
      const employees = await db.employees.toArray()
      const appSettings = await db.settings.get('app-settings')

      const backup: BackupData = {
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        projects,
        runs,
        fixedPointFields,
        employees,
        settings: appSettings || {
          id: 'app-settings',
          language: 'de'
        }
      }

      const json = JSON.stringify(backup, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gedo-backup-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)

      // Update last backup timestamp
      await updateSettings({ lastBackup: new Date().toISOString() })

      alert('Backup erfolgreich erstellt!')
    } catch (error) {
      console.error('Backup error:', error)
      alert('Fehler beim Erstellen des Backups')
    } finally {
      setIsCreatingBackup(false)
    }
  }

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!confirm('Möchten Sie wirklich alle Daten wiederherstellen? Dies überschreibt alle vorhandenen Daten!')) {
      e.target.value = ''
      return
    }

    setIsRestoring(true)

    try {
      const text = await file.text()
      const backup: BackupData = JSON.parse(text)

      // Validate backup structure
      if (!backup.version || !backup.projects || !backup.runs) {
        throw new Error('Ungültiges Backup-Format')
      }

      // Clear all tables
      await db.transaction('rw', [db.projects, db.runs, db.fixedPointFields, db.employees, db.settings], async () => {
        await db.projects.clear()
        await db.runs.clear()
        await db.fixedPointFields.clear()
        await db.employees.clear()
        await db.settings.clear()

        // Restore data
        await db.projects.bulkAdd(backup.projects)
        await db.runs.bulkAdd(backup.runs)
        await db.fixedPointFields.bulkAdd(backup.fixedPointFields)
        await db.employees.bulkAdd(backup.employees)
        await db.settings.put(backup.settings)
      })

      // Update language
      await i18n.changeLanguage(backup.settings.language)

      alert('Backup erfolgreich wiederhergestellt!')
      window.location.reload()
    } catch (error) {
      console.error('Restore error:', error)
      alert('Fehler beim Wiederherstellen des Backups')
    } finally {
      setIsRestoring(false)
      e.target.value = ''
    }
  }

  const handleDeleteAllData = async () => {
    if (!confirm('Möchten Sie wirklich ALLE Daten löschen? Dies kann nicht rückgängig gemacht werden!')) {
      setShowDeleteModal(false)
      return
    }

    if (!confirm('Sind Sie SICHER? Alle Projekte, Messfahrten und Festpunktfelder werden gelöscht!')) {
      setShowDeleteModal(false)
      return
    }

    try {
      await db.transaction('rw', [db.projects, db.runs, db.fixedPointFields, db.employees], async () => {
        await db.projects.clear()
        await db.runs.clear()
        await db.fixedPointFields.clear()
        await db.employees.clear()
      })

      alert('Alle Daten wurden gelöscht')
      setShowDeleteModal(false)
      window.location.reload()
    } catch (error) {
      console.error('Delete error:', error)
      alert('Fehler beim Löschen der Daten')
    }
  }

  const getStorageInfo = async () => {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate()
      const usage = estimate.usage || 0
      const quota = estimate.quota || 0
      return {
        usage: (usage / 1024 / 1024).toFixed(2) + ' MB',
        quota: (quota / 1024 / 1024).toFixed(2) + ' MB',
        percentage: quota > 0 ? ((usage / quota) * 100).toFixed(1) + '%' : '0%'
      }
    }
    return null
  }

  const [storageInfo, setStorageInfo] = useState<{ usage: string; quota: string; percentage: string } | null>(null)

  const loadStorageInfo = async () => {
    const info = await getStorageInfo()
    setStorageInfo(info)
  }

  return (
    <div>
      <PageHeader title={t('nav.settings')} />

      <div className="space-y-4">
        <Card>
          <CardContent>
            <h3 className="text-md font-semibold text-slate-900 mb-4">Sprache</h3>
            <Select
              label="Anzeigesprache"
              value={currentLanguage}
              onChange={(e) => handleLanguageChange(e.target.value as 'de' | 'en')}
              options={[
                { value: 'de', label: 'Deutsch' },
                { value: 'en', label: 'English' }
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h3 className="text-md font-semibold text-slate-900 mb-4">Datensicherung</h3>
            <div className="space-y-3">
              {settings?.lastBackup && (
                <p className="text-sm text-slate-600">
                  Letztes Backup: {new Date(settings.lastBackup).toLocaleString('de-DE')}
                </p>
              )}

              <Button
                onClick={handleCreateBackup}
                disabled={isCreatingBackup}
                className="w-full"
              >
                <Download className="w-4 h-4 mr-2" />
                {isCreatingBackup ? 'Erstelle Backup...' : 'Backup erstellen'}
              </Button>

              <div>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleRestoreBackup}
                  className="hidden"
                  id="restore-backup"
                  disabled={isRestoring}
                />
                <Button
                  variant="secondary"
                  disabled={isRestoring}
                  className="w-full"
                  onClick={() => document.getElementById('restore-backup')?.click()}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {isRestoring ? 'Stelle wieder her...' : 'Backup wiederherstellen'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h3 className="text-md font-semibold text-slate-900 mb-4">App-Information</h3>
            <div className="space-y-3">
              <div className="text-sm">
                <div className="flex justify-between py-2 border-b border-slate-200">
                  <span className="text-slate-600">Version</span>
                  <span className="font-medium">1.0.0</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-200">
                  <span className="text-slate-600">Name</span>
                  <span className="font-medium">{t('app.name')}</span>
                </div>
                {storageInfo && (
                  <>
                    <div className="flex justify-between py-2 border-b border-slate-200">
                      <span className="text-slate-600">Speichernutzung</span>
                      <span className="font-medium">{storageInfo.usage}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-200">
                      <span className="text-slate-600">Verfügbar</span>
                      <span className="font-medium">{storageInfo.quota}</span>
                    </div>
                  </>
                )}
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  loadStorageInfo()
                  setShowInfoModal(true)
                }}
                className="w-full"
              >
                <Info className="w-4 h-4 mr-2" />
                Weitere Informationen
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h3 className="text-md font-semibold text-red-600 mb-4">Gefahrenzone</h3>
            <p className="text-sm text-slate-600 mb-3">
              Das Löschen aller Daten kann nicht rückgängig gemacht werden. Erstellen Sie vorher ein Backup!
            </p>
            <Button
              variant="secondary"
              onClick={() => setShowDeleteModal(true)}
              className="w-full bg-red-50 text-red-700 hover:bg-red-100"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Alle Daten löschen
            </Button>
          </CardContent>
        </Card>
      </div>

      {showDeleteModal && (
        <Modal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title="Alle Daten löschen"
        >
          <div className="space-y-4">
            <p className="text-slate-700">
              Möchten Sie wirklich alle Daten unwiderruflich löschen?
            </p>
            <p className="text-sm text-red-600 font-medium">
              Diese Aktion kann nicht rückgängig gemacht werden!
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1"
              >
                Abbrechen
              </Button>
              <Button
                onClick={handleDeleteAllData}
                className="flex-1 bg-red-600 hover:bg-red-700"
              >
                Löschen
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {showInfoModal && (
        <Modal
          isOpen={showInfoModal}
          onClose={() => setShowInfoModal(false)}
          title="App-Information"
        >
          <div className="space-y-3 text-sm">
            <div>
              <h4 className="font-medium text-slate-900 mb-1">Gedo Scan Tracker</h4>
              <p className="text-slate-600">Version 1.0.0</p>
            </div>
            <div>
              <h4 className="font-medium text-slate-900 mb-1">Beschreibung</h4>
              <p className="text-slate-600">
                Mobile Webapp zur Verwaltung und Protokollierung von Messfahrten mit dem Gedo Scan System.
              </p>
            </div>
            {storageInfo && (
              <div>
                <h4 className="font-medium text-slate-900 mb-1">Speichernutzung</h4>
                <p className="text-slate-600">
                  {storageInfo.usage} von {storageInfo.quota} belegt ({storageInfo.percentage})
                </p>
              </div>
            )}
            <div>
              <h4 className="font-medium text-slate-900 mb-1">Technologie</h4>
              <p className="text-slate-600">
                React + TypeScript + IndexedDB (Offline-fähig)
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
