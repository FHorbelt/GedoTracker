import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/layout/PageHeader'
import { Card, CardContent } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { Input } from '../components/common/Input'
import { SearchInput } from '../components/common/SearchInput'
import { EmptyState } from '../components/common/EmptyState'
import { Modal } from '../components/common/Modal'
import { useFixedPointFields, createFixedPointField, deleteFixedPointField } from '../hooks/useFixedPoints'
import { parseFixedPointFile, exportFixedPointsToCSV } from '../utils/fileParser'
import { FixedPointField, FixedPoint } from '../db/models'
import { Upload, Trash2, MapPin, FileDown, ChevronDown, ChevronUp } from 'lucide-react'

export function FixedPointManager() {
  const { t } = useTranslation()
  const { fields, isLoading } = useFixedPointFields()

  const [showImportModal, setShowImportModal] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importName, setImportName] = useState('')
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)

  const [expandedField, setExpandedField] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImportFile(file)
    setImportName(file.name.replace(/\.(csv|txt)$/i, ''))
    setImportErrors([])
  }

  const handleImport = async () => {
    if (!importFile || !importName.trim()) return

    setIsImporting(true)
    setImportErrors([])

    try {
      const result = await parseFixedPointFile(importFile)

      if (!result.success || result.points.length === 0) {
        setImportErrors(['Keine gültigen Punkte gefunden', ...result.errors])
        setIsImporting(false)
        return
      }

      if (result.errors.length > 0) {
        setImportErrors(result.errors)
      }

      await createFixedPointField(importName.trim(), result.points)

      setShowImportModal(false)
      setImportFile(null)
      setImportName('')
      setImportErrors([])
    } catch (error) {
      console.error('Import error:', error)
      setImportErrors(['Fehler beim Importieren der Datei'])
    } finally {
      setIsImporting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('fixedpoints.deleteConfirm'))) return

    try {
      await deleteFixedPointField(id)
    } catch (error) {
      console.error('Delete error:', error)
    }
  }

  const handleExportField = (field: FixedPointField) => {
    const csv = exportFixedPointsToCSV(field.points)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${field.name}.csv`
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
    <div>
      <PageHeader title={t('fixedpoints.title')} />

      <div className="space-y-4">
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
                            <ChevronUp className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          )}
                          <div>
                            <div className="font-medium text-slate-900">{field.name}</div>
                            <div className="text-sm text-slate-500">
                              {field.points.length} {t('fixedpoints.pointCount')}
                            </div>
                          </div>
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleExportField(field)}
                          className="p-2 text-slate-600 hover:text-primary-600 hover:bg-slate-50 rounded"
                        >
                          <FileDown className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(field.id)}
                          className="p-2 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {expandedField === field.id && (
                      <div className="border-t pt-3">
                        <SearchInput
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          onClear={() => setSearchTerm('')}
                          placeholder={t('fixedpoints.search')}
                          className="mb-3"
                        />
                        <div className="max-h-96 overflow-y-auto space-y-1">
                          {getFilteredPoints(field.points).map(point => (
                            <div
                              key={point.id}
                              className="p-2 bg-slate-50 rounded text-sm"
                            >
                              <div className="flex justify-between items-start">
                                <div>
                                  <span className="font-medium text-slate-900">
                                    {point.pointNumber}
                                  </span>
                                  <span className="ml-2 text-slate-500">
                                    {point.type}
                                  </span>
                                </div>
                              </div>
                              <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                                <div>R: {point.easting.toFixed(3)}</div>
                                <div>H: {point.northing.toFixed(3)}</div>
                                <div>Höhe: {point.elevation.toFixed(3)}m</div>
                              </div>
                            </div>
                          ))}
                          {getFilteredPoints(field.points).length === 0 && (
                            <div className="text-center text-slate-500 py-4">
                              Keine Punkte gefunden
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {showImportModal && (
        <Modal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          title={t('fixedpoints.import')}
        >
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-600 mb-3">
                {t('fixedpoints.importInfo')}
              </p>
              <input
                type="file"
                accept=".csv,.txt"
                onChange={handleFileSelect}
                className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
              />
            </div>

            {importFile && (
              <Input
                label={t('fixedpoints.fieldName')}
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                placeholder="Name des Festpunktfeldes"
                required
              />
            )}

            {importErrors.length > 0 && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm font-medium text-yellow-800 mb-1">Warnungen:</p>
                <ul className="text-sm text-yellow-700 space-y-1">
                  {importErrors.slice(0, 5).map((error, i) => (
                    <li key={i}>• {error}</li>
                  ))}
                  {importErrors.length > 5 && (
                    <li>... und {importErrors.length - 5} weitere</li>
                  )}
                </ul>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowImportModal(false)}
                className="flex-1"
              >
                Abbrechen
              </Button>
              <Button
                onClick={handleImport}
                disabled={!importFile || !importName.trim() || isImporting}
                className="flex-1"
              >
                {isImporting ? 'Importiere...' : 'Importieren'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
