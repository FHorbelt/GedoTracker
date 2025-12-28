import Dexie, { Table } from 'dexie'
import {
  Project,
  MeasurementRun,
  FixedPointField,
  Employee,
  AppSettings,
  TargetBoard
} from './models'

export class GedoDatabase extends Dexie {
  projects!: Table<Project>
  runs!: Table<MeasurementRun>
  fixedPointFields!: Table<FixedPointField>
  employees!: Table<Employee>
  settings!: Table<AppSettings>
  targetBoards!: Table<TargetBoard>

  constructor() {
    super('GedoScanTracker')

    this.version(1).stores({
      projects: 'id, projectNumber, client, date, createdAt',
      runs: 'id, projectId, runNumber, createdAt',
      fixedPointFields: 'id, name, createdAt',
      employees: 'id, name, createdAt',
      settings: 'id'
    })

    // Version 2: Add target boards table
    this.version(2).stores({
      projects: 'id, projectNumber, client, date, createdAt',
      runs: 'id, projectId, runNumber, createdAt',
      fixedPointFields: 'id, name, createdAt',
      employees: 'id, name, createdAt',
      settings: 'id',
      targetBoards: 'id, name, isCustom, createdAt'
    })
  }
}

export const db = new GedoDatabase()

// Initialize default settings and target boards if not present
db.on('ready', async () => {
  const settingsCount = await db.settings.count()
  if (settingsCount === 0) {
    await db.settings.add({
      id: 'app-settings',
      language: 'de'
    })
  }

  // Initialize default target boards
  const targetBoardCount = await db.targetBoards.count()
  if (targetBoardCount === 0) {
    const defaultBoards: TargetBoard[] = [
      // All combinations of standard values
      { id: 'tb-100-n6-0', name: '100mm / -6mm / 0mm', sideLength: 100, boardHeight: -6, boardThickness: 0, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-100-n6-3', name: '100mm / -6mm / 3mm', sideLength: 100, boardHeight: -6, boardThickness: 3, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-100-n6-60', name: '100mm / -6mm / 60mm', sideLength: 100, boardHeight: -6, boardThickness: 60, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-100-200-0', name: '100mm / 200mm / 0mm', sideLength: 100, boardHeight: 200, boardThickness: 0, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-100-200-3', name: '100mm / 200mm / 3mm', sideLength: 100, boardHeight: 200, boardThickness: 3, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-100-200-60', name: '100mm / 200mm / 60mm', sideLength: 100, boardHeight: 200, boardThickness: 60, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-100-500-0', name: '100mm / 500mm / 0mm', sideLength: 100, boardHeight: 500, boardThickness: 0, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-100-500-3', name: '100mm / 500mm / 3mm', sideLength: 100, boardHeight: 500, boardThickness: 3, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-100-500-60', name: '100mm / 500mm / 60mm', sideLength: 100, boardHeight: 500, boardThickness: 60, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-200-n6-0', name: '200mm / -6mm / 0mm', sideLength: 200, boardHeight: -6, boardThickness: 0, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-200-n6-3', name: '200mm / -6mm / 3mm', sideLength: 200, boardHeight: -6, boardThickness: 3, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-200-n6-60', name: '200mm / -6mm / 60mm', sideLength: 200, boardHeight: -6, boardThickness: 60, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-200-200-0', name: '200mm / 200mm / 0mm', sideLength: 200, boardHeight: 200, boardThickness: 0, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-200-200-3', name: '200mm / 200mm / 3mm', sideLength: 200, boardHeight: 200, boardThickness: 3, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-200-200-60', name: '200mm / 200mm / 60mm', sideLength: 200, boardHeight: 200, boardThickness: 60, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-200-500-0', name: '200mm / 500mm / 0mm', sideLength: 200, boardHeight: 500, boardThickness: 0, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-200-500-3', name: '200mm / 500mm / 3mm', sideLength: 200, boardHeight: 500, boardThickness: 3, isCustom: false, createdAt: new Date().toISOString() },
      { id: 'tb-200-500-60', name: '200mm / 500mm / 60mm', sideLength: 200, boardHeight: 500, boardThickness: 60, isCustom: false, createdAt: new Date().toISOString() },
    ]
    await db.targetBoards.bulkAdd(defaultBoards)
  }
})

// Helper functions

export async function getProjectWithRuns(projectId: string) {
  const project = await db.projects.get(projectId)
  if (!project) return null
  
  const runs = await db.runs
    .where('projectId')
    .equals(projectId)
    .sortBy('runNumber')
  
  return { project, runs }
}

export async function getNextRunNumber(projectId: string): Promise<number> {
  const runs = await db.runs
    .where('projectId')
    .equals(projectId)
    .toArray()
  
  if (runs.length === 0) return 1
  
  const maxNumber = Math.max(...runs.map(r => r.runNumber))
  return maxNumber + 1
}

export async function deleteProjectWithRuns(projectId: string) {
  await db.transaction('rw', [db.projects, db.runs], async () => {
    await db.runs.where('projectId').equals(projectId).delete()
    await db.projects.delete(projectId)
  })
}

// Backup functions
export async function createFullBackup(): Promise<string> {
  const projects = await db.projects.toArray()
  const runs = await db.runs.toArray()
  const fixedPointFields = await db.fixedPointFields.toArray()
  const employees = await db.employees.toArray()
  const settings = await db.settings.get('app-settings')

  const backup = {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    projects,
    runs,
    fixedPointFields,
    employees,
    settings: settings || { id: 'app-settings', language: 'de' }
  }

  return JSON.stringify(backup, null, 2)
}

export async function restoreFullBackup(jsonData: string): Promise<void> {
  const backup = JSON.parse(jsonData)
  
  await db.transaction('rw', 
    [db.projects, db.runs, db.fixedPointFields, db.employees, db.settings], 
    async () => {
      // Clear all tables
      await db.projects.clear()
      await db.runs.clear()
      await db.fixedPointFields.clear()
      await db.employees.clear()
      await db.settings.clear()

      // Restore data
      if (backup.projects?.length) await db.projects.bulkAdd(backup.projects)
      if (backup.runs?.length) await db.runs.bulkAdd(backup.runs)
      if (backup.fixedPointFields?.length) await db.fixedPointFields.bulkAdd(backup.fixedPointFields)
      if (backup.employees?.length) await db.employees.bulkAdd(backup.employees)
      if (backup.settings) await db.settings.add(backup.settings)
    }
  )
}

// Project export/import
export async function exportProject(projectId: string): Promise<string> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('Project not found')

  const runs = await db.runs.where('projectId').equals(projectId).toArray()
  
  let fixedPointField = undefined
  if (project.fixedPointFieldId) {
    fixedPointField = await db.fixedPointFields.get(project.fixedPointFieldId)
  }

  const exportData = {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    project,
    runs,
    fixedPointField
  }

  return JSON.stringify(exportData, null, 2)
}

export async function importProject(jsonData: string): Promise<string> {
  const data = JSON.parse(jsonData)
  
  // Generate new IDs to avoid conflicts
  const newProjectId = crypto.randomUUID()
  const project = { ...data.project, id: newProjectId }
  
  const runs = data.runs.map((run: MeasurementRun) => ({
    ...run,
    id: crypto.randomUUID(),
    projectId: newProjectId
  }))

  await db.transaction('rw', [db.projects, db.runs, db.fixedPointFields], async () => {
    // Import fixed point field if present and not already exists
    if (data.fixedPointField) {
      const existing = await db.fixedPointFields.get(data.fixedPointField.id)
      if (!existing) {
        await db.fixedPointFields.add(data.fixedPointField)
      }
    }

    await db.projects.add(project)
    if (runs.length) await db.runs.bulkAdd(runs)
  })

  return newProjectId
}
