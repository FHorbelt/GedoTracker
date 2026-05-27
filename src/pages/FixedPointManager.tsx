import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { Input } from '../components/common/Input'
import { SearchInput } from '../components/common/SearchInput'
import { EmptyState } from '../components/common/EmptyState'
import { Modal } from '../components/common/Modal'
import { useFixedPointFields, createFixedPointField, deleteFixedPointField } from '../hooks/useFixedPoints'
import { useReferenceTrajectories, createReferenceTrajectory, deleteReferenceTrajectory, deleteReferenceTrajectoriesByField } from '../hooks/useReferenceTrajectories'
import { parseKmlMixed, exportFixedPointsToKML, KmlParseResult } from '../utils/fileParser'
import { FixedPointField, FixedPoint } from '../db/models'
import { Upload, Trash2, MapPin, FileDown, ChevronDown, ChevronUp, SkipForward, Map, Loader2, CheckCircle, WifiOff, Route } from 'lucide-react'
import { downloadTilesForField, deleteCachedTiles, getCacheStats, estimateTileCount, TileCacheProgress } from '../utils/offlineTiles'

interface QueuedImport {
  file: File
  parseResult: KmlParseResult | null
  suggestedName: string
}

export function FixedPointManager() {
  const { t } = useTranslation()
  const { fields, isLoading } = useFixedPointFields()
  const { trajectories, isLoading: trajLoading } = useReferenceTrajectories()

  // Multi-file import queue
  const [importQueue, setImportQueue] = useState<QueuedImport[]>([])
  const [currentImportIndex, setCurrentImportIndex] = useState(0)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importName, setImportName] = useState('')
  const [trajectoryNames, setTrajectoryNames] = useState<string[]>([])
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [isParsing, setIsParsing] = useState(false)

  const [expandedField, setExpandedField] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [trajectorySearchTerm, setTrajectorySearchTerm] = useState('')

  // Offline tile download state
  const [downloadingFieldId, setDownloadingFieldId] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<TileCacheProgress | null>(null)
  const [cacheStats, setCacheStats] = useState<Record<string, { count: number; sizeBytes: number }>>({})

  // Load cache stats for all fields
  useEffect(() => {
    async function loadCacheStats() {
      const stats: Record<string, { count: number; sizeBytes: number }> = {}
      for (const field of fields) {
        const fieldStats = await getCacheStats(field.id)
        if (fieldStats && fieldStats.count > 0) {
          stats[field.id] = fieldStats
        }
      }
      setCacheStats(stats)
    }
    loadCacheStats()
  }, [fields])

  const handleDownloadTiles = async (field: FixedPointField) => {
    if (downloadingFieldId) return

    const tileCount = estimateTileCount(field.points)
    if (!confirm(t('fixedpoints.downloadConfirm', { count: tileCount }) || `Möchten Sie ca. ${tileCount} Kacheln für Offline-Nutzung herunterladen?`)) {
      return
    }

    setDownloadingFieldId(field.id)
    setDownloadProgress({ total: 0, downloaded: 0, failed: 0, status: 'downloading' })

    try {
      const result = await downloadTilesForField(field.id, field.points, (progress) => {
        setDownloadProgress({ ...progress })
      })

      // Update cache stats
      const stats = await getCacheStats(field.id)
      if (stats) {
        setCacheStats(prev => ({ ...prev, [field.id]: stats }))
      }
    } catch (error) {
      console.error('Download error:', error)
    } finally {
      setDownloadingFieldId(null)
      setDownloadProgress(null)
    }
  }

  const handleDeleteCache = async (fieldId: string) => {
    if (!confirm(t('fixedpoints.deleteCacheConfirm') || 'Offline-Kacheln für dieses Feld löschen?')) {
      return
    }

    await deleteCachedTiles(fieldId)
    setCacheStats(prev => {
      const newStats = { ...prev }
      delete newStats[fieldId]
      return newStats
    })
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setIsParsing(true)
    setShowImportModal(true)

    // Parse all files and create queue using mixed parser
    const queue: QueuedImport[] = []
    for (const file of Array.from(files)) {
      const suggestedName = file.name.replace(/\.(kml|kmz)$/i, '')
      try {
        const parseResult = await parseKmlMixed(file)
        queue.push({ file, parseResult, suggestedName })
      } catch (error) {
        console.error('Parse error for', file.name, error)
        queue.push({ file, parseResult: null, suggestedName })
      }
    }

    setImportQueue(queue)
    setCurrentImportIndex(0)
    setIsParsing(false)

    // Set initial name from first file's parse result
    if (queue.length > 0 && queue[0].parseResult) {
      setImportName(queue[0].parseResult.fileName || queue[0].suggestedName)
      setImportErrors(queue[0].parseResult.errors)
      setTrajectoryNames(queue[0].parseResult.trajectories.map(t => t.name))
    } else if (queue.length > 0) {
      setImportName(queue[0].suggestedName)
      setImportErrors([])
      setTrajectoryNames([])
    }

    // Reset file input
    e.target.value = ''
  }

  const currentImport = importQueue[currentImportIndex]
  const hasMoreFiles = currentImportIndex < importQueue.length - 1
  const totalFiles = importQueue.length

  const handleImportCurrent = async () => {
    if (!currentImport?.parseResult) return

    const pr = currentImport.parseResult
    const hasPoints = pr.fixedPoints.length > 0
    const hasTrajectories = pr.trajectories.length > 0

    // Need either points with a name, or trajectories
    if (!hasPoints && !hasTrajectories) return
    if (hasPoints && !importName.trim()) return

    setIsImporting(true)

    try {
      // Import fixed points
      let fieldId: string | undefined
      if (hasPoints) {
        fieldId = await createFixedPointField(importName.trim(), pr.fixedPoints)
      }

      // Import trajectories — link to field if both were imported from the same KML
      for (let i = 0; i < pr.trajectories.length; i++) {
        const traj = pr.trajectories[i]
        const name = (trajectoryNames[i] !== undefined ? trajectoryNames[i] : traj.name) || traj.name
        await createReferenceTrajectory(name, traj.points, hasPoints ? fieldId : undefined)
      }

      // Move to next file or close
      if (hasMoreFiles) {
        const nextIndex = currentImportIndex + 1
        const nextImport = importQueue[nextIndex]
        setCurrentImportIndex(nextIndex)
        setImportName(nextImport.parseResult?.fileName || nextImport.suggestedName)
        setImportErrors(nextImport.parseResult?.errors || [])
        setTrajectoryNames(nextImport.parseResult?.trajectories.map(t => t.name) || [])
      } else {
        closeImportModal()
      }
    } catch (error) {
      console.error('Import error:', error)
      setImportErrors([t('fixedpoints.importError') || 'Fehler beim Importieren'])
    } finally {
      setIsImporting(false)
    }
  }

  const handleSkipCurrent = () => {
    if (hasMoreFiles) {
      const nextIndex = currentImportIndex + 1
      const nextImport = importQueue[nextIndex]
      setCurrentImportIndex(nextIndex)
      setImportName(nextImport.parseResult?.fileName || nextImport.suggestedName)
      setImportErrors(nextImport.parseResult?.errors || [])
      setTrajectoryNames(nextImport.parseResult?.trajectories.map(t => t.name) || [])
    } else {
      closeImportModal()
    }
  }

  const closeImportModal = () => {
    setShowImportModal(false)
    setImportQueue([])
    setCurrentImportIndex(0)
    setImportName('')
    setTrajectoryNames([])
    setImportErrors([])
  }

  const handleDeleteTrajectory = async (id: string) => {
    if (!confirm(t('referenceTrajectories.deleteConfirm') || 'Solltrasse wirklich löschen?')) return
    try {
      await deleteReferenceTrajectory(id)
    } catch (error) {
      console.error('Delete trajectory error:', error)
    }
  }

  const handleDelete = async (id: string) => {
    // Check if there are linked trajectories
    const linkedTrajectories = trajectories.filter(t => t.fixedPointFieldId === id)
    const message = linkedTrajectories.length > 0
      ? `${t('fixedpoints.deleteConfirm')}\n\n${linkedTrajectories.length} ${t('referenceTrajectories.linkedWillBeDeleted') || 'zugehörige Solltrasse(n) werden ebenfalls gelöscht.'}`
      : t('fixedpoints.deleteConfirm')
    if (!confirm(message)) return

    try {
      // Delete linked trajectories first
      if (linkedTrajectories.length > 0) {
        await deleteReferenceTrajectoriesByField(id)
      }
      await deleteFixedPointField(id)
    } catch (error) {
      console.error('Delete error:', error)
    }
  }

  const handleExportField = (field: FixedPointField) => {
    const kml = exportFixedPointsToKML(field.points, field.name)
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${field.name}.kml`
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleFieldExpanded = (id: string) => {
    setExpandedField(expandedField === id ? null : id)
  }

  const getFilteredPoints = (points: FixedPoint[]) => {
    if (!searchTerm) return points
    return points.filter(p =>
      p.pointNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.type.toLowerCase().includes(searchTerm.toLowerCase())
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {t('fixedpoints.pageDescription')}
        </p>

        <Button
          onClick={() => setShowImportModal(true)}
          className="w-full"
        >
          <Upload className="w-4 h-4 mr-2" />
          {t('fixedpoints.import')}
        </Button>

        {fields.length === 0 ? (
          <Card>
            <EmptyState
              icon={<MapPin className="w-8 h-8" />}
              title={t('fixedpoints.noFields')}
              description={t('fixedpoints.importInfo')}
              action={
                <Button onClick={() => setShowImportModal(true)}>
                  <Upload className="w-4 h-4 mr-2" />
                  {t('fixedpoints.import')}
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {fields.map(field => (
              <Card key={field.id}>
                <CardContent className="py-3">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <button
                          onClick={() => toggleFieldExpanded(field.id)}
                          className="flex items-center gap-2 text-left w-full"
                        >
                          {expandedField === field.id ? (
                            <ChevronUp className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                          ) : (
                            <ChevronDown className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                          )}
                          <div>
                            <div className="font-medium" style={{ color: 'var(--color-text)' }}>{field.name}</div>
                            <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                              {field.points.length} {t('fixedpoints.pointCount')}
                              {trajectories.filter(tr => tr.fixedPointFieldId === field.id).length > 0 && (
                                <span className="ml-1">
                                  · {trajectories.filter(tr => tr.fixedPointFieldId === field.id).length} {t('referenceTrajectories.trajectoryCount') || 'Trassen'}
                                </span>
                              )}
                              {cacheStats[field.id] && (
                                <span className="ml-2 inline-flex items-center gap-1">
                                  <WifiOff className="w-3 h-3" style={{ color: '#22c55e' }} />
                                  <span style={{ color: '#22c55e' }}>{formatBytes(cacheStats[field.id].sizeBytes)}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      </div>
                      <div className="flex gap-1">
                        {/* Offline Tiles Button */}
                        {cacheStats[field.id] ? (
                          <button
                            onClick={() => handleDeleteCache(field.id)}
                            className="p-2 rounded"
                            title={t('fixedpoints.deleteCache') || 'Offline-Kacheln löschen'}
                            style={{ color: '#22c55e' }}
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        ) : downloadingFieldId === field.id ? (
                          <div className="p-2 flex items-center gap-1">
                            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--color-text-muted)' }} />
                            {downloadProgress && (
                              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                {downloadProgress.downloaded}/{downloadProgress.total}
                              </span>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => handleDownloadTiles(field)}
                            className="p-2 rounded"
                            title={t('fixedpoints.downloadTiles') || 'Offline-Kacheln herunterladen'}
                            style={{ color: 'var(--color-text-secondary)' }}
                          >
                            <Map className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleExportField(field)}
                          className="p-2 rounded"
                          style={{ color: 'var(--color-text-secondary)' }}
                        >
                          <FileDown className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(field.id)}
                          className="p-2 text-red-600 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {expandedField === field.id && (
                      <div style={{ borderTop: '1px solid var(--color-border)' }} className="pt-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Left column: Fixed Points */}
                          <div>
                            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                              <MapPin className="w-3 h-3 inline mr-1" />
                              {t('fixedpoints.pointCount')} ({field.points.length})
                            </label>
                            <SearchInput
                              value={searchTerm}
                              onChange={(e) => setSearchTerm(e.target.value)}
                              onClear={() => setSearchTerm('')}
                              placeholder={t('fixedpoints.search')}
                              className="mb-2"
                            />
                            <div className="max-h-72 overflow-y-auto space-y-1">
                              {getFilteredPoints(field.points).map(point => (
                                <div
                                  key={point.id}
                                  className="p-2 rounded text-sm"
                                  style={{ backgroundColor: 'var(--color-bg)' }}
                                >
                                  <div className="flex justify-between items-start">
                                    <div>
                                      <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                                        {point.pointNumber}
                                      </span>
                                      <span className="ml-2" style={{ color: 'var(--color-text-muted)' }}>
                                        {point.type}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="text-xs mt-1 space-y-0.5" style={{ color: 'var(--color-text-muted)' }}>
                                    <div>Lon: {point.longitude?.toFixed(7)}°</div>
                                    <div>Lat: {point.latitude?.toFixed(7)}°</div>
                                    <div>Höhe: {point.elevation?.toFixed(2)}m</div>
                                  </div>
                                </div>
                              ))}
                              {getFilteredPoints(field.points).length === 0 && (
                                <div className="text-center py-4" style={{ color: 'var(--color-text-muted)' }}>
                                  Keine Punkte gefunden
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Right column: Trajectories */}
                          <div>
                            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                              <Route className="w-3 h-3 inline mr-1" style={{ color: '#f59e0b' }} />
                              {t('referenceTrajectories.trajectoryCount') || 'Trassen'} ({trajectories.filter(tr => tr.fixedPointFieldId === field.id).length})
                            </label>
                            <SearchInput
                              value={trajectorySearchTerm}
                              onChange={(e) => setTrajectorySearchTerm(e.target.value)}
                              onClear={() => setTrajectorySearchTerm('')}
                              placeholder={t('referenceTrajectories.search') || 'Trasse suchen...'}
                              className="mb-2"
                            />
                            {(() => {
                              const fieldTrajectories = trajectories.filter(tr => tr.fixedPointFieldId === field.id)
                              const filtered = trajectorySearchTerm
                                ? fieldTrajectories.filter(tr => tr.name.toLowerCase().includes(trajectorySearchTerm.toLowerCase()))
                                : fieldTrajectories
                              return filtered.length > 0 ? (
                                <div className="max-h-72 overflow-y-auto space-y-1">
                                  {filtered.map(traj => (
                                    <div
                                      key={traj.id}
                                      className="flex items-center justify-between pl-2 pr-1 py-1.5 rounded"
                                      style={{ backgroundColor: 'var(--color-bg)' }}
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <Route className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#f59e0b' }} />
                                        <span className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{traj.name}</span>
                                        <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                                          ({traj.points.length})
                                        </span>
                                      </div>
                                      <button
                                        onClick={() => handleDeleteTrajectory(traj.id)}
                                        className="p-1.5 text-red-600 rounded flex-shrink-0"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-center py-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                                  {trajectorySearchTerm
                                    ? (t('referenceTrajectories.noSearchResults') || 'Keine Trassen gefunden')
                                    : (t('referenceTrajectories.noTrajectory') || 'Keine Trassen')}
                                </div>
                              )
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

      {/* Unlinked Solltrassen Section (without field assignment) */}
      {trajectories.filter(t => !t.fixedPointFieldId).length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            <Route className="w-5 h-5 inline mr-2" style={{ color: '#f59e0b' }} />
            {t('referenceTrajectories.unlinkedTitle') || 'Solltrassen (ohne Zuordnung)'}
          </h2>
          {trajectories.filter(t => !t.fixedPointFieldId).map(traj => (
            <Card key={traj.id}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium" style={{ color: 'var(--color-text)' }}>{traj.name}</div>
                    <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      {traj.points.length} {t('referenceTrajectories.pointCount') || 'Punkte'}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteTrajectory(traj.id)}
                    className="p-2 text-red-600 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showImportModal && (
        <Modal
          isOpen={showImportModal}
          onClose={closeImportModal}
          title={totalFiles > 1
            ? `${t('fixedpoints.import')} (${currentImportIndex + 1}/${totalFiles})`
            : t('fixedpoints.import')
          }
        >
          <div className="space-y-4">
            {isParsing ? (
              <div className="flex flex-col items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-3" />
                <p style={{ color: 'var(--color-text-muted)' }}>
                  {t('fixedpoints.parsing') || 'Dateien werden analysiert...'}
                </p>
              </div>
            ) : !currentImport ? (
              <div>
                <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('fixedpoints.importInfo')}
                </p>
                <input
                  type="file"
                  accept=".kml,.kmz"
                  multiple
                  onChange={handleFileSelect}
                  className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                  style={{ color: 'var(--color-text-muted)' }}
                />
              </div>
            ) : (
              <>
                {/* File info */}
                <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                  <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    {t('fixedpoints.file') || 'Datei'}: <span style={{ color: 'var(--color-text)' }}>{currentImport.file.name}</span>
                  </div>
                  {currentImport.parseResult && (
                    <div className="text-sm mt-1 space-y-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      {currentImport.parseResult.fixedPoints.length > 0 && (
                        <div>{currentImport.parseResult.fixedPoints.length} {t('fixedpoints.pointCount')}</div>
                      )}
                      {currentImport.parseResult.trajectories.length > 0 && (
                        <div>{currentImport.parseResult.trajectories.length} {t('referenceTrajectories.title') || 'Solltrassen'}</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Parse failed */}
                {!currentImport.parseResult?.success && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-700">
                      {t('fixedpoints.parseError') || 'Datei konnte nicht gelesen werden'}
                    </p>
                  </div>
                )}

                {/* Name input for fixed points */}
                {currentImport.parseResult?.success && currentImport.parseResult.fixedPoints.length > 0 && (
                  <Input
                    label={t('fixedpoints.fieldName')}
                    value={importName}
                    onChange={(e) => setImportName(e.target.value)}
                    placeholder={t('fixedpoints.fieldNamePlaceholder') || 'Name des Festpunktfeldes'}
                    required
                  />
                )}

                {/* Trajectory name inputs */}
                {currentImport.parseResult?.success && currentImport.parseResult.trajectories.length > 0 && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      {t('referenceTrajectories.title') || 'Solltrassen'}
                    </label>
                    {currentImport.parseResult.trajectories.map((traj, i) => (
                      <Input
                        key={i}
                        value={trajectoryNames[i] ?? traj.name}
                        onChange={(e) => {
                          const newNames = [...trajectoryNames]
                          newNames[i] = e.target.value
                          setTrajectoryNames(newNames)
                        }}
                        placeholder={`Trasse ${i + 1}`}
                      />
                    ))}
                  </div>
                )}

                {/* Warnings */}
                {importErrors.length > 0 && (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-sm font-medium text-yellow-800 mb-1">
                      {t('fixedpoints.warnings') || 'Warnungen'}:
                    </p>
                    <ul className="text-sm text-yellow-700 space-y-1">
                      {importErrors.slice(0, 5).map((error, i) => (
                        <li key={i}>• {error}</li>
                      ))}
                      {importErrors.length > 5 && (
                        <li>... {t('fixedpoints.andMore', { count: importErrors.length - 5 }) || `und ${importErrors.length - 5} weitere`}</li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                  {hasMoreFiles ? (
                    <Button
                      variant="secondary"
                      onClick={handleSkipCurrent}
                      className="flex-1"
                    >
                      <SkipForward className="w-4 h-4 mr-2" />
                      {t('fixedpoints.skip') || 'Überspringen'}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={closeImportModal}
                      className="flex-1"
                    >
                      {t('common.cancel')}
                    </Button>
                  )}
                  <Button
                    onClick={handleImportCurrent}
                    disabled={
                      !currentImport.parseResult?.success ||
                      isImporting ||
                      (currentImport.parseResult.fixedPoints.length > 0 && !importName.trim())
                    }
                    className="flex-1"
                  >
                    {isImporting
                      ? (t('fixedpoints.importing') || 'Importiere...')
                      : (t('fixedpoints.import'))
                    }
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
