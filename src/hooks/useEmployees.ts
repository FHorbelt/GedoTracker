import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { Employee } from '../db/models'
import { v4 as uuidv4 } from 'uuid'

export function useEmployees() {
  const employees = useLiveQuery(() =>
    db.employees.orderBy('name').toArray()
  )

  const isLoading = employees === undefined

  return { employees: employees || [], isLoading }
}

export async function addEmployee(name: string, company?: string, location?: string): Promise<string> {
  const employee: Employee = {
    id: uuidv4(),
    name,
    company: company || undefined,
    location: location || undefined,
    createdAt: new Date().toISOString()
  }

  await db.employees.add(employee)
  return employee.id
}

export async function deleteEmployee(id: string): Promise<void> {
  await db.employees.delete(id)
}

export async function updateEmployee(id: string, name: string, company?: string, location?: string): Promise<void> {
  await db.employees.update(id, {
    name,
    company: company || undefined,
    location: location || undefined
  })
}

/**
 * Import employees from CSV text.
 * Supports semicolon and comma as delimiters.
 * Expected columns: Vorname/FirstName, Nachname/LastName, Firma/Company (optional), Standort/Location (optional)
 * Header row is auto-detected and skipped.
 * Existing employees (same name) get their company/location updated if CSV provides values.
 */
export async function importEmployeesFromCsv(csvText: string): Promise<{ imported: number; updated: number; skipped: number }> {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '')
  if (lines.length === 0) return { imported: 0, updated: 0, skipped: 0 }

  // Detect delimiter: use semicolon if first line contains it, otherwise comma
  const delimiter = lines[0].includes(';') ? ';' : ','

  // Parse all lines
  const rows = lines.map(line => line.split(delimiter).map(cell => cell.trim()))

  // Detect header row: check if first row contains known header keywords
  const headerKeywords = ['vorname', 'nachname', 'firstname', 'lastname', 'name', 'firma', 'company', 'standort', 'location']
  const firstRowLower = rows[0].map(cell => cell.toLowerCase())
  const hasHeader = firstRowLower.some(cell => headerKeywords.includes(cell))

  const dataRows = hasHeader ? rows.slice(1) : rows

  // Get existing employees for duplicate detection and updating
  const existingEmployees = await db.employees.toArray()
  const existingByName = new Map(existingEmployees.map(e => [e.name.toLowerCase(), e]))

  let imported = 0
  let updated = 0
  let skipped = 0

  const newEmployees: Employee[] = []

  for (const row of dataRows) {
    if (row.length < 2) {
      skipped++
      continue
    }

    const firstName = row[0].trim()
    const lastName = row[1].trim()

    if (!firstName && !lastName) {
      skipped++
      continue
    }

    const name = `${firstName} ${lastName}`.trim()
    const company = row[2]?.trim() || undefined
    const location = row[3]?.trim() || undefined

    // Check if employee already exists (case-insensitive)
    const existing = existingByName.get(name.toLowerCase())
    if (existing) {
      // Update company/location if CSV provides new values
      const needsUpdate =
        (company && existing.company !== company) ||
        (location && existing.location !== location)
      if (needsUpdate) {
        await db.employees.update(existing.id, {
          company: company || existing.company,
          location: location || existing.location
        })
        updated++
      } else {
        skipped++
      }
      continue
    }

    // Also check within current batch
    if (newEmployees.some(e => e.name.toLowerCase() === name.toLowerCase())) {
      skipped++
      continue
    }

    newEmployees.push({
      id: uuidv4(),
      name,
      company,
      location,
      createdAt: new Date().toISOString()
    })
    imported++
  }

  if (newEmployees.length > 0) {
    await db.employees.bulkAdd(newEmployees)
  }

  return { imported, updated, skipped }
}
