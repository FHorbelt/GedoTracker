import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { Input } from '../components/common/Input'
import { Modal } from '../components/common/Modal'
import { useSettings } from '../hooks/useSettings'
import { useTheme } from '../contexts/ThemeContext'
import { useEmployees } from '../hooks/useEmployees'
import { db } from '../db/database'
import { BackupData } from '../db/models'
import { Toggle } from '../components/common/Toggle'
import { Download, Upload, Trash2, Info, FileText, Plus, Edit, X, Check, Users, Image, Star, Sun, Moon, FlaskConical, ChevronRight, Wrench } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { APP_VERSION } from '../version'
import { MeasurementJob } from '../db/models'
import { useLogos, addLogo, deleteLogo, setDefaultLogo, updateLogo, fileToBase64, getLogoDataUrl } from '../hooks/useLogos'
import {
  TARGET_BOARD_PRESETS,
  DEFAULT_QUICK_SELECT_TARGET_IDS,
  MIN_QUICK_SELECT_TARGETS,
  MAX_QUICK_SELECT_TARGETS
} from '../utils/targetPresets'

export function Settings() {
  const { t, i18n } = useTranslation()
  const { settings, updateLanguage, updateSettings, currentLanguage } = useSettings()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const { employees } = useEmployees()
  const { logos } = useLogos()

  const [isCreatingBackup, setIsCreatingBackup] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showInfoModal, setShowInfoModal] = useState(false)
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)

  // Logo management state
  const [editingLogoId, setEditingLogoId] = useState<string | null>(null)
  const [editingLogoName, setEditingLogoName] = useState('')

  const handleLanguageChange = async (language: 'de' | 'en') => {
    await updateLanguage(language)
  }

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true)

    try {
      const projects = await db.projects.toArray()
      const measurementJobs = await db.measurementJobs.toArray()
      const runs = await db.runs.toArray()
      const fixedPointFields = await db.fixedPointFields.toArray()
      const referenceTrajectories = await db.referenceTrajectories.toArray()
      const employees = await db.employees.toArray()
      const logos = await db.logos.toArray()
      const appSettings = await db.settings.get('app-settings')

      const backup: BackupData = {
        version: '2.2.0',
        createdAt: new Date().toISOString(),
        projects,
        measurementJobs,
        runs,
        fixedPointFields,
        referenceTrajectories,
        employees,
        logos,
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
      a.download = `mmc-backup-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)

      // Update last backup timestamp
      await updateSettings({ lastBackup: new Date().toISOString() })

      alert(t('settings.backupSuccess'))
    } catch (error) {
      console.error('Backup error:', error)
      alert(t('settings.backupError'))
    } finally {
      setIsCreatingBackup(false)
    }
  }

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!confirm(t('settings.restoreConfirm'))) {
      e.target.value = ''
      return
    }

    setIsRestoring(true)

    try {
      const text = await file.text()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const backup: any = JSON.parse(text)

      // Validate backup structure
      if (!backup.version || !backup.projects || !backup.runs) {
        throw new Error(t('settings.invalidBackupFormat'))
      }

      // Check if this is an old backup format (version < 2.0.0 or no measurementJobs)
      const isOldFormat = !backup.measurementJobs || backup.measurementJobs.length === 0

      let projectsToImport = backup.projects
      let measurementJobsToImport: MeasurementJob[] = []
      let runsToImport = backup.runs

      if (isOldFormat) {
        // Migrate old format: Create MeasurementJobs from project data
        console.log('Migrating old backup format to new structure...')

        measurementJobsToImport = []
        const projectIdToJobId: Record<string, string> = {}

        // Build a map of employee names to IDs from the backup
        const employeeNameToId: Record<string, string> = {}
        if (backup.employees) {
          for (const emp of backup.employees) {
            employeeNameToId[emp.name] = emp.id
          }
        }

        // For each project, create a MeasurementJob
        for (const project of backup.projects) {
          const jobId = uuidv4()
          projectIdToJobId[project.id] = jobId

          // Map old employee names to IDs
          const employeeIds: string[] = []
          if (project.employees && Array.isArray(project.employees)) {
            for (const empName of project.employees) {
              const empId = employeeNameToId[empName]
              if (empId) {
                employeeIds.push(empId)
              }
            }
          }

          // Create MeasurementJob from old project data
          const measurementJob: MeasurementJob = {
            id: jobId,
            projectId: project.id,
            jobName: currentLanguage === 'de' ? 'Import aus v1.0' : 'Import from v1.0',
            jobDate: project.date || new Date().toISOString().split('T')[0],
            object: project.object || '',
            scannerType: project.scannerType || 'GX50',
            scannerAlignment: project.scannerOrientation || '80°/80°',
            withTower: project.withTower || false,
            towerHeight: project.towerHeight || 0,
            trolleySerialNumber: undefined,
            scannerSerialNumber: undefined,
            employeeIds: employeeIds,
            weather: project.weather || { condition: 'cloudy', environment: 'outdoor' },
            fixedPointFieldId: project.fixedPointFieldId || undefined,
            createdAt: project.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
          measurementJobsToImport.push(measurementJob)
        }

        // Update runs to reference the new measurementJobId
        runsToImport = backup.runs.map((run: any) => ({
          ...run,
          measurementJobId: projectIdToJobId[run.projectId] || run.projectId,
          // Ensure required fields have defaults
          routeNumber: run.track || run.routeNumber || '',
          trackType: run.trackType || 'unbekannt',
          scannerType: run.scannerType || 'GX50'
        }))

        // Clean up projects - remove fields that are now in MeasurementJob
        projectsToImport = backup.projects.map((project: any) => ({
          id: project.id,
          projectNumber: project.projectNumber || '',
          client: project.client || '',
          constructionProject: project.constructionProject || '',
          startDate: project.date || project.startDate || new Date().toISOString().split('T')[0],
          createdAt: project.createdAt,
          updatedAt: project.updatedAt
        }))
      }

      // Clear all tables
      await db.transaction('rw', [db.projects, db.measurementJobs, db.runs, db.fixedPointFields, db.referenceTrajectories, db.employees, db.logos, db.settings], async () => {
        await db.projects.clear()
        await db.measurementJobs.clear()
        await db.runs.clear()
        await db.fixedPointFields.clear()
        await db.referenceTrajectories.clear()
        await db.employees.clear()
        await db.logos.clear()
        await db.settings.clear()

        // Restore data
        if (projectsToImport?.length) await db.projects.bulkAdd(projectsToImport)
        if (measurementJobsToImport.length > 0) {
          await db.measurementJobs.bulkAdd(measurementJobsToImport)
        } else if (backup.measurementJobs?.length) {
          await db.measurementJobs.bulkAdd(backup.measurementJobs)
        }
        if (runsToImport?.length) await db.runs.bulkAdd(runsToImport)
        if (backup.fixedPointFields?.length) await db.fixedPointFields.bulkAdd(backup.fixedPointFields)
        if (backup.referenceTrajectories?.length) await db.referenceTrajectories.bulkAdd(backup.referenceTrajectories)
        if (backup.employees?.length) await db.employees.bulkAdd(backup.employees)
        if (backup.logos?.length) await db.logos.bulkAdd(backup.logos)
        if (backup.settings) await db.settings.put(backup.settings)
      })

      // Update language
      await i18n.changeLanguage(backup.settings.language)

      alert(t('settings.restoreSuccess'))
      window.location.reload()
    } catch (error) {
      console.error('Restore error:', error)
      alert(t('settings.restoreError'))
    } finally {
      setIsRestoring(false)
      e.target.value = ''
    }
  }

  const handleDeleteAllData = async () => {
    if (!confirm(t('settings.deleteConfirm'))) {
      setShowDeleteModal(false)
      return
    }

    if (!confirm(t('settings.deleteConfirmExtra'))) {
      setShowDeleteModal(false)
      return
    }

    try {
      await db.transaction('rw', [db.projects, db.measurementJobs, db.runs, db.fixedPointFields, db.referenceTrajectories, db.employees, db.logos], async () => {
        await db.projects.clear()
        await db.measurementJobs.clear()
        await db.runs.clear()
        await db.fixedPointFields.clear()
        await db.referenceTrajectories.clear()
        await db.employees.clear()
        await db.logos.clear()
      })

      alert(t('settings.deleteSuccess'))
      setShowDeleteModal(false)
      window.location.reload()
    } catch (error) {
      console.error('Delete error:', error)
      alert(t('settings.deleteError'))
    }
  }

  // Logo handlers
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert(currentLanguage === 'de' ? 'Bitte ein Bild auswählen' : 'Please select an image')
      return
    }

    // Validate file size (max 500KB)
    if (file.size > 500 * 1024) {
      alert(currentLanguage === 'de' ? 'Bild ist zu groß (max. 500KB)' : 'Image is too large (max 500KB)')
      return
    }

    try {
      const { data, mimeType } = await fileToBase64(file)
      const name = file.name.replace(/\.[^/.]+$/, '') // Remove file extension
      await addLogo(name, data, mimeType)
    } catch (error) {
      console.error('Error uploading logo:', error)
      alert(currentLanguage === 'de' ? 'Fehler beim Hochladen' : 'Upload failed')
    }

    e.target.value = ''
  }

  const handleUpdateLogoName = async (id: string) => {
    if (!editingLogoName.trim()) return
    await updateLogo(id, { name: editingLogoName.trim() })
    setEditingLogoId(null)
    setEditingLogoName('')
  }

  const handleDeleteLogo = async (id: string, name: string) => {
    const confirmMsg = currentLanguage === 'de'
      ? `Logo "${name}" wirklich löschen?`
      : `Really delete logo "${name}"?`
    if (confirm(confirmMsg)) {
      await deleteLogo(id)
    }
  }

  const handleSetDefaultLogo = async (id: string) => {
    await setDefaultLogo(id)
  }

  const startEditingLogo = (id: string, name: string) => {
    setEditingLogoId(id)
    setEditingLogoName(name)
  }

  const cancelEditingLogo = () => {
    setEditingLogoId(null)
    setEditingLogoName('')
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

  const isDark = theme === 'dark'

  return (
    <div className="space-y-4">
      {/* 1. Darstellung */}
      <Card>
        <CardContent>
          <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
            {t('settings.appearance')}
          </h3>
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('settings.theme')}
            </span>
            <div
              className="flex rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <button
                onClick={() => setTheme('light')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: !isDark ? '#3b82f6' : 'transparent',
                  color: !isDark ? 'white' : 'var(--color-text)'
                }}
              >
                <Sun className="w-4 h-4" />
                {t('settings.lightMode')}
              </button>
              <button
                onClick={() => setTheme('dark')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: isDark ? '#3b82f6' : 'transparent',
                  color: isDark ? 'white' : 'var(--color-text)'
                }}
              >
                <Moon className="w-4 h-4" />
                {t('settings.darkMode')}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Datensicherung */}
      <Card>
        <CardContent>
          <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
            {t('settings.dataBackup')}
          </h3>
          <div className="space-y-3">
            {settings?.lastBackup && (
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {t('settings.lastBackup')}: {new Date(settings.lastBackup).toLocaleString(currentLanguage === 'de' ? 'de-DE' : 'en-US')}
              </p>
            )}

            <Button
              onClick={handleCreateBackup}
              disabled={isCreatingBackup}
              className="w-full"
            >
              <Download className="w-4 h-4 mr-2" />
              {isCreatingBackup ? t('settings.creatingBackup') : t('settings.createBackup')}
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
                {isRestoring ? t('settings.restoringBackup') : t('settings.restoreBackup')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Mitarbeiter */}
      <Card>
        <CardContent>
          <button
            onClick={() => navigate('/settings/employees')}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5" style={{ color: 'var(--color-text)' }} />
              <span className="text-md font-semibold" style={{ color: 'var(--color-text)' }}>
                {t('settings.employees')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {employees.length}
              </span>
              <ChevronRight className="w-5 h-5" style={{ color: 'var(--color-text-muted)' }} />
            </div>
          </button>
        </CardContent>
      </Card>

      {/* 4. Tools */}
      <Card>
        <CardContent>
          <h3 className="text-md font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Wrench className="w-5 h-5" />
            {t('settings.tools')}
          </h3>
          <button
            onClick={() => navigate('/settings/mx9-calibration')}
            className="w-full flex items-center justify-between p-2 rounded-lg"
            style={{ backgroundColor: 'var(--color-bg)' }}
          >
            <span className="text-sm" style={{ color: 'var(--color-text)' }}>
              {t('settings.mx9Calibration')}
            </span>
            <ChevronRight className="w-5 h-5" style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </CardContent>
      </Card>

      {/* Target Schnellauswahl */}
      <Card>
        <CardContent>
          <h3 className="text-md font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
            {t('settings.quickSelectTargets')}
          </h3>
          <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
            {t('settings.quickSelectTargetsDescription')}
          </p>
          {(() => {
            const selectedIds = settings?.quickSelectTargetIds ?? DEFAULT_QUICK_SELECT_TARGET_IDS
            const selectedCount = selectedIds.length
            const canDeselect = selectedCount > MIN_QUICK_SELECT_TARGETS
            const canSelect = selectedCount < MAX_QUICK_SELECT_TARGETS

            const toggle = (id: string) => {
              const isSelected = selectedIds.includes(id)
              if (isSelected) {
                if (!canDeselect) return
                updateSettings({ quickSelectTargetIds: selectedIds.filter(x => x !== id) })
              } else {
                if (!canSelect) return
                const nextSet = new Set([...selectedIds, id])
                const ordered = TARGET_BOARD_PRESETS.filter(p => nextSet.has(p.id)).map(p => p.id)
                updateSettings({ quickSelectTargetIds: ordered })
              }
            }

            return (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {TARGET_BOARD_PRESETS.map(preset => {
                    const isSelected = selectedIds.includes(preset.id)
                    const isDisabled = isSelected ? !canDeselect : !canSelect
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => toggle(preset.id)}
                        disabled={isDisabled}
                        className="flex flex-col items-center rounded-lg p-1 transition-colors"
                        style={{
                          border: isSelected ? '2px solid #3b82f6' : '1px solid var(--color-border)',
                          backgroundColor: isSelected ? (isDark ? 'rgba(59,130,246,0.15)' : '#eff6ff') : 'var(--color-bg-card)',
                          opacity: isDisabled ? 0.4 : 1,
                          cursor: isDisabled ? 'not-allowed' : 'pointer'
                        }}
                      >
                        <img
                          src={preset.image}
                          alt={preset.label}
                          className="w-full h-auto object-contain"
                          style={{ maxHeight: '48px', filter: isDark ? 'invert(1)' : 'none' }}
                        />
                        <span className="text-xs mt-1" style={{ color: isSelected ? '#3b82f6' : 'var(--color-text-secondary)' }}>
                          {preset.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs mt-3" style={{ color: 'var(--color-text-muted)' }}>
                  {t('settings.quickSelectTargetsCount', { count: selectedCount, max: MAX_QUICK_SELECT_TARGETS })}
                </p>
              </>
            )
          })()}
        </CardContent>
      </Card>

      {/* 5. Sprache */}
      <Card>
        <CardContent>
          <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
            {t('settings.language')}
          </h3>
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('settings.displayLanguage')}
            </span>
            <div
              className="flex rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <button
                onClick={() => handleLanguageChange('de')}
                className="px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: currentLanguage === 'de' ? '#3b82f6' : 'transparent',
                  color: currentLanguage === 'de' ? 'white' : 'var(--color-text)'
                }}
              >
                DE
              </button>
              <button
                onClick={() => handleLanguageChange('en')}
                className="px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: currentLanguage === 'en' ? '#3b82f6' : 'transparent',
                  color: currentLanguage === 'en' ? 'white' : 'var(--color-text)'
                }}
              >
                EN
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 5. Firmenlogos */}
      <Card>
        <CardContent>
          <h3 className="text-md font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Image className="w-5 h-5" />
            {t('settings.companyLogos')}
          </h3>
          <div className="flex items-start gap-2 p-3 mb-4 rounded-lg border border-blue-500/50 bg-blue-500/10">
            <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              {currentLanguage === 'de'
                ? 'Der Name des Logos wird als Firmenname in Projekten verwendet.'
                : 'The logo name is used as the company name in projects.'}
            </p>
          </div>

          {/* Logo List */}
          <div className="space-y-2 mb-3">
            {logos.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {currentLanguage === 'de' ? 'Keine Logos vorhanden' : 'No logos yet'}
              </p>
            ) : (
              logos.map((logo) => (
                <div
                  key={logo.id}
                  className="flex items-center gap-3 p-2 rounded"
                  style={{ backgroundColor: 'var(--color-bg)' }}
                >
                  <img
                    src={getLogoDataUrl(logo)}
                    alt={logo.name}
                    className="w-12 h-12 object-contain rounded"
                    style={{ backgroundColor: 'white' }}
                  />
                  {editingLogoId === logo.id ? (
                    <>
                      <Input
                        value={editingLogoName}
                        onChange={(e) => setEditingLogoName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateLogoName(logo.id)
                          if (e.key === 'Escape') cancelEditingLogo()
                        }}
                        className="flex-1"
                        autoFocus
                      />
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUpdateLogoName(logo.id)}
                          className="p-1.5 text-green-600"
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={cancelEditingLogo}
                          className="p-1.5"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex-1">
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                          {logo.name}
                        </span>
                        {logo.isDefault && (
                          <span className="ml-2 text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                            {currentLanguage === 'de' ? 'Standard' : 'Default'}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {!logo.isDefault && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSetDefaultLogo(logo.id)}
                            className="p-1.5"
                            title={currentLanguage === 'de' ? 'Als Standard setzen' : 'Set as default'}
                          >
                            <Star className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEditingLogo(logo.id, logo.name)}
                          className="p-1.5"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteLogo(logo.id, logo.name)}
                          className="p-1.5 text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Add Logo */}
          <input
            type="file"
            accept="image/*"
            onChange={handleLogoUpload}
            className="hidden"
            id="logo-upload"
          />
          <Button
            variant="secondary"
            onClick={() => document.getElementById('logo-upload')?.click()}
            className="w-full"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('settings.addLogo')}
          </Button>
          <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
            {currentLanguage === 'de' ? 'Max. 500KB, PNG/JPG empfohlen' : 'Max 500KB, PNG/JPG recommended'}
          </p>
        </CardContent>
      </Card>

      {/* 6. App-Information */}
      <Card>
        <CardContent>
          <h3 className="text-md font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
            {t('settings.appInfo')}
          </h3>
          <div className="space-y-3">
            <div className="text-sm">
              <div
                className="flex justify-between py-2"
                style={{ borderBottom: '1px solid var(--color-border)' }}
              >
                <span style={{ color: 'var(--color-text-secondary)' }}>{t('settings.version')}</span>
                <span className="font-medium" style={{ color: 'var(--color-text)' }}>{APP_VERSION}</span>
              </div>
              <div
                className="flex justify-between py-2"
                style={{ borderBottom: '1px solid var(--color-border)' }}
              >
                <span style={{ color: 'var(--color-text-secondary)' }}>{t('settings.name')}</span>
                <span className="font-medium" style={{ color: 'var(--color-text)' }}>{t('app.name')}</span>
              </div>
              {storageInfo && (
                <>
                  <div
                    className="flex justify-between py-2"
                    style={{ borderBottom: '1px solid var(--color-border)' }}
                  >
                    <span style={{ color: 'var(--color-text-secondary)' }}>{t('settings.storageUsage')}</span>
                    <span className="font-medium" style={{ color: 'var(--color-text)' }}>{storageInfo.usage}</span>
                  </div>
                  <div
                    className="flex justify-between py-2"
                    style={{ borderBottom: '1px solid var(--color-border)' }}
                  >
                    <span style={{ color: 'var(--color-text-secondary)' }}>{t('settings.storageAvailable')}</span>
                    <span className="font-medium" style={{ color: 'var(--color-text)' }}>{storageInfo.quota}</span>
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  loadStorageInfo()
                  setShowInfoModal(true)
                }}
                className="flex-1"
              >
                <Info className="w-4 h-4 mr-2" />
                {t('settings.moreInfo')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowReleaseNotes(true)}
                className="flex-1"
              >
                <FileText className="w-4 h-4 mr-2" />
                {t('releaseNotes.title')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 7. Beta-Features */}
      <Card>
        <CardContent>
          <h3 className="text-md font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <FlaskConical className="w-5 h-5" />
            {t('settings.betaFeatures')}
          </h3>
          <div className="space-y-3">
            <Toggle
              checked={settings?.betaSplineEnabled ?? false}
              onChange={(checked) => updateSettings({ betaSplineEnabled: checked })}
              label={t('settings.betaSplineEnabled')}
            />
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('settings.betaSplineDescription')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 8. Gefahrenzone */}
      <Card>
        <CardContent>
          <h3 className="text-md font-semibold text-red-600 mb-4">
            {t('settings.dangerZone')}
          </h3>
          <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            {t('settings.deleteAllDataWarning')}
          </p>
          <Button
            variant="secondary"
            onClick={() => setShowDeleteModal(true)}
            className="w-full"
            style={{ backgroundColor: isDark ? 'transparent' : '#fef2f2', color: '#b91c1c', border: isDark ? '1px solid #b91c1c' : 'none' }}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {t('settings.deleteAllData')}
          </Button>
        </CardContent>
      </Card>

      {showDeleteModal && (
        <Modal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          title={t('settings.deleteAllData')}
        >
          <div className="space-y-4">
            <p style={{ color: 'var(--color-text)' }}>
              {t('settings.deleteConfirm')}
            </p>
            <p className="text-sm font-medium text-red-600">
              {t('settings.deleteIrreversible')}
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1"
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleDeleteAllData}
                className="flex-1 bg-red-600 hover:bg-red-700"
              >
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {showInfoModal && (
        <Modal
          isOpen={showInfoModal}
          onClose={() => setShowInfoModal(false)}
          title={t('settings.appInfo')}
        >
          <div className="space-y-3 text-sm">
            <div>
              <h4 className="font-medium mb-1" style={{ color: 'var(--color-text)' }}>{t('app.name')}</h4>
              <p style={{ color: 'var(--color-text-secondary)' }}>{t('settings.version')} {APP_VERSION}</p>
            </div>
            <div>
              <h4 className="font-medium mb-1" style={{ color: 'var(--color-text)' }}>{t('settings.about')}</h4>
              <p style={{ color: 'var(--color-text-secondary)' }}>
                {t('settings.description')}
              </p>
            </div>
            {storageInfo && (
              <div>
                <h4 className="font-medium mb-1" style={{ color: 'var(--color-text)' }}>{t('settings.storageUsage')}</h4>
                <p style={{ color: 'var(--color-text-secondary)' }}>
                  {storageInfo.usage} / {storageInfo.quota} ({storageInfo.percentage})
                </p>
              </div>
            )}
            <div>
              <h4 className="font-medium mb-1" style={{ color: 'var(--color-text)' }}>{t('settings.technology')}</h4>
              <p style={{ color: 'var(--color-text-secondary)' }}>
                React + TypeScript + IndexedDB (Offline)
              </p>
            </div>
          </div>
        </Modal>
      )}

      {showReleaseNotes && (
        <Modal
          isOpen={showReleaseNotes}
          onClose={() => setShowReleaseNotes(false)}
          title={t('releaseNotes.title')}
        >
          <div className="space-y-4 text-sm max-h-96 overflow-y-auto">
            {/* v1.0.9 */}
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: 'var(--color-bg-input)',
                border: '1px solid var(--color-border)'
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold" style={{ color: '#3b82f6' }}>
                  v1.0.9 - {t('releaseNotes.v1.0.9.title')}
                </h4>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {t('releaseNotes.v1.0.9.date')}
                </span>
              </div>
              <ul className="space-y-1.5">
                {(t('releaseNotes.v1.0.9.notes', { returnObjects: true }) as string[]).map((note, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <span style={{ color: '#22c55e' }}>✓</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* v1.0.8 */}
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: 'var(--color-bg-input)',
                border: '1px solid var(--color-border)'
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold" style={{ color: '#3b82f6' }}>
                  v1.0.8 - {t('releaseNotes.v1.0.8.title')}
                </h4>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {t('releaseNotes.v1.0.8.date')}
                </span>
              </div>
              <ul className="space-y-1.5">
                {(t('releaseNotes.v1.0.8.notes', { returnObjects: true }) as string[]).map((note, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <span style={{ color: '#22c55e' }}>✓</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* v1.0.7 */}
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: 'var(--color-bg-input)',
                border: '1px solid var(--color-border)'
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold" style={{ color: '#3b82f6' }}>
                  v1.0.7 - {t('releaseNotes.v1.0.7.title')}
                </h4>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {t('releaseNotes.v1.0.7.date')}
                </span>
              </div>
              <ul className="space-y-1.5">
                {(t('releaseNotes.v1.0.7.notes', { returnObjects: true }) as string[]).map((note, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <span style={{ color: '#22c55e' }}>✓</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* v1.0.6 */}
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: 'var(--color-bg-input)',
                border: '1px solid var(--color-border)'
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold" style={{ color: '#3b82f6' }}>
                  v1.0.6 - {t('releaseNotes.v1.0.6.title')}
                </h4>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {t('releaseNotes.v1.0.6.date')}
                </span>
              </div>
              <ul className="space-y-1.5">
                {(t('releaseNotes.v1.0.6.notes', { returnObjects: true }) as string[]).map((note, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <span style={{ color: '#22c55e' }}>✓</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* v1.0.5 */}
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: 'var(--color-bg-input)',
                border: '1px solid var(--color-border)'
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold" style={{ color: '#3b82f6' }}>
                  v1.0.5 - {t('releaseNotes.v1.0.5.title')}
                </h4>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {t('releaseNotes.v1.0.5.date')}
                </span>
              </div>
              <ul className="space-y-1.5">
                {(t('releaseNotes.v1.0.5.notes', { returnObjects: true }) as string[]).map((note, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <span style={{ color: '#22c55e' }}>✓</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* v1.0.4 */}
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: 'var(--color-bg-input)',
                border: '1px solid var(--color-border)'
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold" style={{ color: '#3b82f6' }}>
                  v1.0.4 - {t('releaseNotes.v1.0.4.title')}
                </h4>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {t('releaseNotes.v1.0.4.date')}
                </span>
              </div>
              <ul className="space-y-1.5">
                {(t('releaseNotes.v1.0.4.notes', { returnObjects: true }) as string[]).map((note, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <span style={{ color: '#22c55e' }}>✓</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* v1.0.3 */}
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: 'var(--color-bg-input)',
                border: '1px solid var(--color-border)'
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold" style={{ color: '#3b82f6' }}>
                  v1.0.3 - {t('releaseNotes.v1.0.3.title')}
                </h4>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {t('releaseNotes.v1.0.3.date')}
                </span>
              </div>
              <ul className="space-y-1.5">
                {(t('releaseNotes.v1.0.3.notes', { returnObjects: true }) as string[]).map((note, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <span style={{ color: '#22c55e' }}>✓</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* v1.0.2 */}
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: 'var(--color-bg-input)',
                border: '1px solid var(--color-border)'
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold" style={{ color: '#3b82f6' }}>
                  v1.0.2 - {t('releaseNotes.v1.0.2.title')}
                </h4>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {t('releaseNotes.v1.0.2.date')}
                </span>
              </div>
              <ul className="space-y-1.5">
                {(t('releaseNotes.v1.0.2.notes', { returnObjects: true }) as string[]).map((note, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <span style={{ color: '#22c55e' }}>✓</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* v1.0.1 */}
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: 'var(--color-bg-input)',
                border: '1px solid var(--color-border)'
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold" style={{ color: '#3b82f6' }}>
                  v1.0.1 - {t('releaseNotes.v1.0.1.title')}
                </h4>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {t('releaseNotes.v1.0.1.date')}
                </span>
              </div>
              <ul className="space-y-1.5">
                {(t('releaseNotes.v1.0.1.notes', { returnObjects: true }) as string[]).map((note, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <span style={{ color: '#22c55e' }}>✓</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
