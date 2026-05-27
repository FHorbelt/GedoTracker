import { useState, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { Input } from '../components/common/Input'
import { useEmployees, addEmployee, updateEmployee, deleteEmployee, importEmployeesFromCsv } from '../hooks/useEmployees'
import { Plus, Edit, X, Check, Trash2, Upload, Filter } from 'lucide-react'

export function EmployeeManager() {
  const { t, i18n } = useTranslation()
  const currentLanguage = i18n.language
  const { employees } = useEmployees()

  const [newEmployeeName, setNewEmployeeName] = useState('')
  const [newEmployeeCompany, setNewEmployeeCompany] = useState('')
  const [newEmployeeLocation, setNewEmployeeLocation] = useState('')
  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null)
  const [editingEmployeeName, setEditingEmployeeName] = useState('')
  const [editingEmployeeCompany, setEditingEmployeeCompany] = useState('')
  const [editingEmployeeLocation, setEditingEmployeeLocation] = useState('')
  const [filterCompany, setFilterCompany] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const csvInputRef = useRef<HTMLInputElement>(null)

  // Collect unique companies and locations for filter dropdowns
  const companies = useMemo(() => {
    const set = new Set<string>()
    employees.forEach(e => { if (e.company) set.add(e.company) })
    return Array.from(set).sort()
  }, [employees])

  const locations = useMemo(() => {
    const set = new Set<string>()
    employees.forEach(e => { if (e.location) set.add(e.location) })
    return Array.from(set).sort()
  }, [employees])

  const hasFiltersAvailable = companies.length > 0 || locations.length > 0
  const isFilterActive = filterCompany !== '' || filterLocation !== ''

  // Filter employees
  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      if (filterCompany && emp.company !== filterCompany) return false
      if (filterLocation && emp.location !== filterLocation) return false
      return true
    })
  }, [employees, filterCompany, filterLocation])

  const handleAddEmployee = async () => {
    if (!newEmployeeName.trim()) return
    await addEmployee(
      newEmployeeName.trim(),
      newEmployeeCompany.trim() || undefined,
      newEmployeeLocation.trim() || undefined
    )
    setNewEmployeeName('')
    setNewEmployeeCompany('')
    setNewEmployeeLocation('')
    setShowAddEmployee(false)
  }

  const handleUpdateEmployee = async (id: string) => {
    if (!editingEmployeeName.trim()) return
    await updateEmployee(
      id,
      editingEmployeeName.trim(),
      editingEmployeeCompany.trim() || undefined,
      editingEmployeeLocation.trim() || undefined
    )
    setEditingEmployeeId(null)
    setEditingEmployeeName('')
    setEditingEmployeeCompany('')
    setEditingEmployeeLocation('')
  }

  const handleDeleteEmployee = async (id: string, name: string) => {
    const confirmMsg = currentLanguage === 'de'
      ? `Mitarbeiter "${name}" wirklich löschen?`
      : `Really delete employee "${name}"?`
    if (confirm(confirmMsg)) {
      await deleteEmployee(id)
    }
  }

  const startEditingEmployee = (id: string, name: string, company?: string, location?: string) => {
    setEditingEmployeeId(id)
    setEditingEmployeeName(name)
    setEditingEmployeeCompany(company || '')
    setEditingEmployeeLocation(location || '')
  }

  const cancelEditingEmployee = () => {
    setEditingEmployeeId(null)
    setEditingEmployeeName('')
    setEditingEmployeeCompany('')
    setEditingEmployeeLocation('')
  }

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const result = await importEmployeesFromCsv(text)
      alert(t('settings.importCsvSuccess', {
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped
      }))
    } catch (error) {
      console.error('CSV import error:', error)
      alert(currentLanguage === 'de' ? 'Fehler beim CSV-Import' : 'CSV import error')
    }

    // Reset file input
    if (csvInputRef.current) {
      csvInputRef.current.value = ''
    }
  }

  const clearFilters = () => {
    setFilterCompany('')
    setFilterLocation('')
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          {/* Filter bar */}
          {hasFiltersAvailable && (
            <div className="mb-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-1.5 text-sm mb-2"
                style={{ color: isFilterActive ? '#3b82f6' : 'var(--color-text-muted)' }}
              >
                <Filter className="w-3.5 h-3.5" />
                {t('settings.filter')}
                {isFilterActive && (
                  <span className="px-1.5 py-0.5 rounded-full text-xs" style={{
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    color: '#3b82f6'
                  }}>
                    {filteredEmployees.length}/{employees.length}
                  </span>
                )}
              </button>

              {showFilters && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {companies.length > 0 && (
                    <select
                      value={filterCompany}
                      onChange={(e) => setFilterCompany(e.target.value)}
                      className="text-sm rounded-lg px-2 py-1.5"
                      style={{
                        backgroundColor: 'var(--color-bg-input)',
                        color: 'var(--color-text)',
                        border: `1px solid ${filterCompany ? '#3b82f6' : 'var(--color-border-input)'}`
                      }}
                    >
                      <option value="">{t('settings.allCompanies')}</option>
                      {companies.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  )}

                  {locations.length > 0 && (
                    <select
                      value={filterLocation}
                      onChange={(e) => setFilterLocation(e.target.value)}
                      className="text-sm rounded-lg px-2 py-1.5"
                      style={{
                        backgroundColor: 'var(--color-bg-input)',
                        color: 'var(--color-text)',
                        border: `1px solid ${filterLocation ? '#3b82f6' : 'var(--color-border-input)'}`
                      }}
                    >
                      <option value="">{t('settings.allLocations')}</option>
                      {locations.map(l => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  )}

                  {isFilterActive && (
                    <button
                      onClick={clearFilters}
                      className="text-xs px-2 py-1 rounded"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Employee List */}
          <div className="space-y-2 mb-3">
            {filteredEmployees.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {isFilterActive
                  ? (currentLanguage === 'de' ? 'Keine Mitarbeiter für diesen Filter' : 'No employees match this filter')
                  : (currentLanguage === 'de' ? 'Keine Mitarbeiter vorhanden' : 'No employees yet')
                }
              </p>
            ) : (
              filteredEmployees.map((emp) => (
                <div
                  key={emp.id}
                  className="flex items-center justify-between p-2 rounded"
                  style={{ backgroundColor: 'var(--color-bg)' }}
                >
                  {editingEmployeeId === emp.id ? (
                    <div className="flex-1 mr-2 space-y-2">
                      <Input
                        value={editingEmployeeName}
                        onChange={(e) => setEditingEmployeeName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateEmployee(emp.id)
                          if (e.key === 'Escape') cancelEditingEmployee()
                        }}
                        placeholder={currentLanguage === 'de' ? 'Name' : 'Name'}
                        autoFocus
                      />
                      <Input
                        value={editingEmployeeCompany}
                        onChange={(e) => setEditingEmployeeCompany(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateEmployee(emp.id)
                          if (e.key === 'Escape') cancelEditingEmployee()
                        }}
                        placeholder={t('settings.companyPlaceholder')}
                      />
                      <Input
                        value={editingEmployeeLocation}
                        onChange={(e) => setEditingEmployeeLocation(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateEmployee(emp.id)
                          if (e.key === 'Escape') cancelEditingEmployee()
                        }}
                        placeholder={t('settings.locationPlaceholder')}
                      />
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUpdateEmployee(emp.id)}
                          className="p-1.5 text-green-600"
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={cancelEditingEmployee}
                          className="p-1.5"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <span className="text-sm" style={{ color: 'var(--color-text)' }}>{emp.name}</span>
                        {(emp.company || emp.location) && (
                          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            {[emp.company, emp.location].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEditingEmployee(emp.id, emp.name, emp.company, emp.location)}
                          className="p-1.5"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteEmployee(emp.id, emp.name)}
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

          {/* Add Employee */}
          {showAddEmployee ? (
            <div className="space-y-2">
              <Input
                value={newEmployeeName}
                onChange={(e) => setNewEmployeeName(e.target.value)}
                placeholder={currentLanguage === 'de' ? 'Name des Mitarbeiters' : 'Employee name'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddEmployee()
                  if (e.key === 'Escape') setShowAddEmployee(false)
                }}
                autoFocus
              />
              <Input
                value={newEmployeeCompany}
                onChange={(e) => setNewEmployeeCompany(e.target.value)}
                placeholder={t('settings.companyPlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddEmployee()
                  if (e.key === 'Escape') setShowAddEmployee(false)
                }}
              />
              <Input
                value={newEmployeeLocation}
                onChange={(e) => setNewEmployeeLocation(e.target.value)}
                placeholder={t('settings.locationPlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddEmployee()
                  if (e.key === 'Escape') setShowAddEmployee(false)
                }}
              />
              <div className="flex gap-2">
                <Button onClick={handleAddEmployee} size="sm">
                  <Check className="w-4 h-4" />
                </Button>
                <Button variant="secondary" onClick={() => { setShowAddEmployee(false); setNewEmployeeName(''); setNewEmployeeCompany(''); setNewEmployeeLocation('') }} size="sm">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setShowAddEmployee(true)}
                className="flex-1"
                size="sm"
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('settings.addEmployee')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => csvInputRef.current?.click()}
                size="sm"
              >
                <Upload className="w-4 h-4 mr-2" />
                {t('settings.importCsv')}
              </Button>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleCsvImport}
                className="hidden"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
