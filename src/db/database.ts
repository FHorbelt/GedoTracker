import Dexie, { type Table } from 'dexie'
import type {
  Project,
  MeasurementJob,
  MeasurementRun,
  FixedPointField,
  ReferenceTrajectory,
  Employee,
  AppSettings,
  TargetBoard,
  CompanyLogo,
  MapTile
} from './models'
import { DEFAULT_QUICK_SELECT_TARGET_IDS } from '../utils/targetPresets'

export class AppDatabase extends Dexie {
  projects!: Table<Project>
  measurementJobs!: Table<MeasurementJob>  // NEU
  runs!: Table<MeasurementRun>
  fixedPointFields!: Table<FixedPointField>
  employees!: Table<Employee>
  logos!: Table<CompanyLogo>               // NEU
  settings!: Table<AppSettings>
  targetBoards!: Table<TargetBoard>
  mapTiles!: Table<MapTile>                // Offline-Kacheln
  referenceTrajectories!: Table<ReferenceTrajectory>  // Solltrassen

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

    // Version 3: Add measurement jobs table, update project and run schemas
    // - Projects: date -> startDate, removed scanner/weather/employees (moved to jobs)
    // - Runs: added measurementJobId, routeNumber, trackType, scanner fields
    // - New: measurementJobs table
    this.version(3).stores({
      projects: 'id, projectNumber, startDate, createdAt',
      measurementJobs: 'id, projectId, jobName, jobDate, createdAt',
      runs: 'id, projectId, measurementJobId, runNumber, createdAt',
      fixedPointFields: 'id, name, createdAt',
      employees: 'id, name, createdAt',
      settings: 'id',
      targetBoards: 'id, name, isCustom, createdAt'
    }).upgrade(async tx => {
      // Migration: Update existing projects (date -> startDate)
      await tx.table('projects').toCollection().modify(project => {
        if (project.date && !project.startDate) {
          project.startDate = project.date
        }
      })

      // Migration: Existing runs without measurementJobId get a placeholder
      // They will need to be assigned to a job manually or via migration UI
      await tx.table('runs').toCollection().modify(run => {
        if (!run.measurementJobId) {
          run.measurementJobId = '__legacy_migration__'
        }
        // Convert old track field to routeNumber if needed
        if (run.track && !run.routeNumber) {
          run.routeNumber = run.track
        }
        // Default trackType if not set
        if (!run.trackType) {
          run.trackType = 'unbekannt'
        }
      })
    })

    // Version 4: Add company logos table
    this.version(4).stores({
      projects: 'id, projectNumber, startDate, createdAt',
      measurementJobs: 'id, projectId, jobName, jobDate, createdAt',
      runs: 'id, projectId, measurementJobId, runNumber, createdAt',
      fixedPointFields: 'id, name, createdAt',
      employees: 'id, name, createdAt',
      logos: 'id, name, isDefault, createdAt',
      settings: 'id',
      targetBoards: 'id, name, isCustom, createdAt'
    })

    // Version 5: Add map tiles cache table for offline maps
    this.version(5).stores({
      projects: 'id, projectNumber, startDate, createdAt',
      measurementJobs: 'id, projectId, jobName, jobDate, createdAt',
      runs: 'id, projectId, measurementJobId, runNumber, createdAt',
      fixedPointFields: 'id, name, createdAt',
      employees: 'id, name, createdAt',
      logos: 'id, name, isDefault, createdAt',
      settings: 'id',
      targetBoards: 'id, name, isCustom, createdAt',
      mapTiles: 'id, fieldId, z, x, y, timestamp'
    })

    // Version 6: Add reference trajectories table (Solltrassen)
    this.version(6).stores({
      projects: 'id, projectNumber, startDate, createdAt',
      measurementJobs: 'id, projectId, jobName, jobDate, createdAt',
      runs: 'id, projectId, measurementJobId, runNumber, createdAt',
      fixedPointFields: 'id, name, createdAt',
      referenceTrajectories: 'id, name, createdAt',
      employees: 'id, name, createdAt',
      logos: 'id, name, isDefault, createdAt',
      settings: 'id',
      targetBoards: 'id, name, isCustom, createdAt',
      mapTiles: 'id, fieldId, z, x, y, timestamp'
    })

    // Version 7: Add fixedPointFieldId index to reference trajectories
    this.version(7).stores({
      projects: 'id, projectNumber, startDate, createdAt',
      measurementJobs: 'id, projectId, jobName, jobDate, createdAt',
      runs: 'id, projectId, measurementJobId, runNumber, createdAt',
      fixedPointFields: 'id, name, createdAt',
      referenceTrajectories: 'id, name, fixedPointFieldId, createdAt',
      employees: 'id, name, createdAt',
      logos: 'id, name, isDefault, createdAt',
      settings: 'id',
      targetBoards: 'id, name, isCustom, createdAt',
      mapTiles: 'id, fieldId, z, x, y, timestamp'
    })

    // Version 8: Add company and location fields to employees
    this.version(8).stores({
      projects: 'id, projectNumber, startDate, createdAt',
      measurementJobs: 'id, projectId, jobName, jobDate, createdAt',
      runs: 'id, projectId, measurementJobId, runNumber, createdAt',
      fixedPointFields: 'id, name, createdAt',
      referenceTrajectories: 'id, name, fixedPointFieldId, createdAt',
      employees: 'id, name, company, location, createdAt',
      logos: 'id, name, isDefault, createdAt',
      settings: 'id',
      targetBoards: 'id, name, isCustom, createdAt',
      mapTiles: 'id, fieldId, z, x, y, timestamp'
    })
  }
}

export const db = new AppDatabase()

// Initialize default settings and target boards if not present
db.on('ready', async () => {
  const settingsCount = await db.settings.count()
  if (settingsCount === 0) {
    await db.settings.add({
      id: 'app-settings',
      language: 'de',
      quickSelectTargetIds: DEFAULT_QUICK_SELECT_TARGET_IDS
    })
  } else {
    const existing = await db.settings.get('app-settings')
    if (existing && !existing.quickSelectTargetIds) {
      await db.settings.update('app-settings', { quickSelectTargetIds: DEFAULT_QUICK_SELECT_TARGET_IDS })
    }
  }

  // === MIGRATION: Create MeasurementJobs for legacy runs ===
  // Check for runs with placeholder measurementJobId from version upgrade
  const legacyRuns = await db.runs
    .where('measurementJobId')
    .equals('__legacy_migration__')
    .toArray()

  if (legacyRuns.length > 0) {
    console.log(`Found ${legacyRuns.length} legacy runs to migrate...`)

    // Group runs by projectId
    const runsByProject = new Map<string, typeof legacyRuns>()
    for (const run of legacyRuns) {
      const projectRuns = runsByProject.get(run.projectId) || []
      projectRuns.push(run)
      runsByProject.set(run.projectId, projectRuns)
    }

    // Get all employees for name-to-ID mapping
    const allEmployees = await db.employees.toArray()
    const employeeNameToId: Record<string, string> = {}
    for (const emp of allEmployees) {
      employeeNameToId[emp.name] = emp.id
    }

    // For each project with legacy runs, create a MeasurementJob
    for (const [projectId, projectRuns] of runsByProject) {
      const project = await db.projects.get(projectId)
      if (!project) continue

      // Check if project has old-style fields (from before migration)
      // We need to read raw data because TypeScript types might not include old fields
      const rawProject = project as unknown as Record<string, unknown>

      const jobId = crypto.randomUUID()

      // Map old employee names to IDs if present
      const employeeIds: string[] = []
      if (rawProject.employees && Array.isArray(rawProject.employees)) {
        for (const empName of rawProject.employees) {
          if (typeof empName === 'string') {
            const empId = employeeNameToId[empName]
            if (empId) employeeIds.push(empId)
          }
        }
      }

      // Create MeasurementJob from old project data
      const measurementJob: MeasurementJob = {
        id: jobId,
        projectId: projectId,
        jobName: 'Migration v1.0',
        jobDate: (rawProject.date as string) || project.startDate || new Date().toISOString().split('T')[0],
        object: (rawProject.object as string) || '',
        scannerType: (rawProject.scannerType as 'GX50' | 'TX8') || 'GX50',
        scannerAlignment: (rawProject.scannerOrientation as '80°/80°' | '90°/90°') || '80°/80°',
        withTower: (rawProject.withTower as boolean) || false,
        towerHeight: (rawProject.towerHeight as number) || 0,
        trolleySerialNumber: undefined,
        scannerSerialNumber: undefined,
        employeeIds: employeeIds,
        weather: (rawProject.weather as { condition: 'sunny' | 'cloudy' | 'rainy'; environment: 'outdoor' | 'covered' }) || { condition: 'cloudy', environment: 'outdoor' },
        fixedPointFieldId: (rawProject.fixedPointFieldId as string) || undefined,
        createdAt: project.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      await db.measurementJobs.add(measurementJob)
      console.log(`Created MeasurementJob "${measurementJob.jobName}" for project ${projectId}`)

      // Update all runs to point to the new job
      for (const run of projectRuns) {
        await db.runs.update(run.id, {
          measurementJobId: jobId,
          // Also ensure required fields have defaults
          routeNumber: (run as unknown as Record<string, unknown>).track as string || run.routeNumber || '',
          trackType: run.trackType || 'unbekannt',
          scannerType: run.scannerType || 'GX50'
        })
      }
      console.log(`Migrated ${projectRuns.length} runs to job ${jobId}`)
    }

    console.log('Legacy migration completed!')
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

// Projekt mit allen Messjobs laden
export async function getProjectWithJobs(projectId: string) {
  const project = await db.projects.get(projectId)
  if (!project) return null

  const jobs = await db.measurementJobs
    .where('projectId')
    .equals(projectId)
    .sortBy('createdAt')

  return { project, jobs }
}

// Messjob mit allen Runs laden
export async function getJobWithRuns(jobId: string) {
  const job = await db.measurementJobs.get(jobId)
  if (!job) return null

  const runs = await db.runs
    .where('measurementJobId')
    .equals(jobId)
    .sortBy('runNumber')

  return { job, runs }
}

// Legacy: Projekt mit allen Runs (über alle Jobs hinweg)
export async function getProjectWithRuns(projectId: string) {
  const project = await db.projects.get(projectId)
  if (!project) return null

  const runs = await db.runs
    .where('projectId')
    .equals(projectId)
    .sortBy('runNumber')

  return { project, runs }
}

// Nächste Run-Nummer für einen Messjob
export async function getNextRunNumber(measurementJobId: string): Promise<number> {
  const runs = await db.runs
    .where('measurementJobId')
    .equals(measurementJobId)
    .toArray()

  if (runs.length === 0) return 1

  const maxNumber = Math.max(...runs.map(r => r.runNumber))
  return maxNumber + 1
}

// Projekt mit allen Jobs und Runs löschen
export async function deleteProjectWithJobs(projectId: string) {
  await db.transaction('rw', [db.projects, db.measurementJobs, db.runs], async () => {
    // Erst alle Runs der Jobs löschen
    const jobs = await db.measurementJobs.where('projectId').equals(projectId).toArray()
    for (const job of jobs) {
      await db.runs.where('measurementJobId').equals(job.id).delete()
    }
    // Dann alle Jobs löschen
    await db.measurementJobs.where('projectId').equals(projectId).delete()
    // Dann das Projekt löschen
    await db.projects.delete(projectId)
  })
}

// Messjob mit allen Runs löschen
export async function deleteJobWithRuns(jobId: string) {
  await db.transaction('rw', [db.measurementJobs, db.runs], async () => {
    await db.runs.where('measurementJobId').equals(jobId).delete()
    await db.measurementJobs.delete(jobId)
  })
}

// Legacy: Alias für Abwärtskompatibilität
export async function deleteProjectWithRuns(projectId: string) {
  return deleteProjectWithJobs(projectId)
}

// Backup functions
export async function createFullBackup(): Promise<string> {
  const projects = await db.projects.toArray()
  const measurementJobs = await db.measurementJobs.toArray()
  const runs = await db.runs.toArray()
  const fixedPointFields = await db.fixedPointFields.toArray()
  const referenceTrajectories = await db.referenceTrajectories.toArray()
  const employees = await db.employees.toArray()
  const logos = await db.logos.toArray()
  const settings = await db.settings.get('app-settings')

  const backup = {
    version: '2.3.0',
    createdAt: new Date().toISOString(),
    projects,
    measurementJobs,
    runs,
    fixedPointFields,
    referenceTrajectories,
    employees,
    logos,
    settings: settings || { id: 'app-settings', language: 'de' }
  }

  return JSON.stringify(backup, null, 2)
}

export async function restoreFullBackup(jsonData: string): Promise<void> {
  const backup = JSON.parse(jsonData)

  await db.transaction('rw',
    [db.projects, db.measurementJobs, db.runs, db.fixedPointFields, db.referenceTrajectories, db.employees, db.logos, db.settings],
    async () => {
      // Clear all tables
      await db.projects.clear()
      await db.measurementJobs.clear()
      await db.runs.clear()
      await db.fixedPointFields.clear()
      await db.referenceTrajectories.clear()
      await db.employees.clear()
      await db.logos.clear()
      await db.settings.clear()

      // Restore data
      if (backup.projects?.length) await db.projects.bulkAdd(backup.projects)
      if (backup.measurementJobs?.length) await db.measurementJobs.bulkAdd(backup.measurementJobs)
      if (backup.runs?.length) await db.runs.bulkAdd(backup.runs)
      if (backup.fixedPointFields?.length) await db.fixedPointFields.bulkAdd(backup.fixedPointFields)
      if (backup.referenceTrajectories?.length) await db.referenceTrajectories.bulkAdd(backup.referenceTrajectories)
      if (backup.employees?.length) await db.employees.bulkAdd(backup.employees)
      if (backup.logos?.length) await db.logos.bulkAdd(backup.logos)
      if (backup.settings) await db.settings.add(backup.settings)
    }
  )
}

// Project export/import
export async function exportProject(projectId: string): Promise<string> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('Project not found')

  // Alle Messjobs des Projekts laden
  const measurementJobs = await db.measurementJobs
    .where('projectId')
    .equals(projectId)
    .toArray()

  // Alle Runs des Projekts laden
  const runs = await db.runs.where('projectId').equals(projectId).toArray()

  // Alle verwendeten Festpunktfelder sammeln
  const fixedPointFieldIds = new Set<string>()
  for (const job of measurementJobs) {
    if (job.fixedPointFieldId) {
      fixedPointFieldIds.add(job.fixedPointFieldId)
    }
  }

  const fixedPointFields: FixedPointField[] = []
  for (const fieldId of fixedPointFieldIds) {
    const field = await db.fixedPointFields.get(fieldId)
    if (field) fixedPointFields.push(field)
  }

  const exportData = {
    version: '2.0.0',
    createdAt: new Date().toISOString(),
    project,
    measurementJobs,
    runs,
    fixedPointFields
  }

  return JSON.stringify(exportData, null, 2)
}

export async function importProject(jsonData: string): Promise<string> {
  const data = JSON.parse(jsonData)

  // Generate new IDs to avoid conflicts
  const newProjectId = crypto.randomUUID()
  const project = { ...data.project, id: newProjectId }

  // Map old job IDs to new job IDs
  const jobIdMap = new Map<string, string>()

  const measurementJobs = (data.measurementJobs || []).map((job: MeasurementJob) => {
    const newJobId = crypto.randomUUID()
    jobIdMap.set(job.id, newJobId)
    return {
      ...job,
      id: newJobId,
      projectId: newProjectId
    }
  })

  const runs = (data.runs || []).map((run: MeasurementRun) => ({
    ...run,
    id: crypto.randomUUID(),
    projectId: newProjectId,
    measurementJobId: jobIdMap.get(run.measurementJobId) || run.measurementJobId
  }))

  await db.transaction('rw', [db.projects, db.measurementJobs, db.runs, db.fixedPointFields], async () => {
    // Import fixed point fields if present and not already exists
    if (data.fixedPointFields?.length) {
      for (const field of data.fixedPointFields) {
        const existing = await db.fixedPointFields.get(field.id)
        if (!existing) {
          await db.fixedPointFields.add(field)
        }
      }
    }
    // Legacy: Single fixedPointField
    if (data.fixedPointField) {
      const existing = await db.fixedPointFields.get(data.fixedPointField.id)
      if (!existing) {
        await db.fixedPointFields.add(data.fixedPointField)
      }
    }

    await db.projects.add(project)
    if (measurementJobs.length) await db.measurementJobs.bulkAdd(measurementJobs)
    if (runs.length) await db.runs.bulkAdd(runs)
  })

  return newProjectId
}

// === ENHANCED IMPORT WITH CONFLICT HANDLING ===

export type ConflictResolution = 'overwrite' | 'rename' | 'skip'

export interface ImportConflict {
  type: 'project' | 'fixedPointField' | 'employee' | 'logo'
  name: string
  existingId: string
  importId: string
}

export interface ImportAnalysis {
  // Parsed data
  exportType: 'project' | 'job'
  version: string

  // What will be imported
  project: Project | null
  measurementJobs: MeasurementJob[]
  runs: MeasurementRun[]
  fixedPointFields: FixedPointField[]
  employees: Employee[]
  logo: CompanyLogo | null

  // Conflicts found
  conflicts: ImportConflict[]

  // Summary
  hasConflicts: boolean
}

export interface ImportDecisions {
  // Key: conflictId (type-importId), Value: resolution
  [key: string]: ConflictResolution | undefined
}

/**
 * Analyze import data and detect conflicts without making any changes.
 */
export async function analyzeImport(jsonData: string): Promise<ImportAnalysis> {
  const data = JSON.parse(jsonData)

  // Debug logging
  console.log('Import data:', {
    version: data.version,
    exportType: data.exportType,
    hasProject: !!data.project,
    measurementJobsCount: data.measurementJobs?.length || 0,
    measurementJobCount: data.measurementJob ? 1 : 0,
    runsCount: data.runs?.length || 0
  })

  const conflicts: ImportConflict[] = []

  // Determine export type
  const exportType: 'project' | 'job' = data.exportType || (data.measurementJob ? 'job' : 'project')

  // Parse project
  const project: Project | null = data.project || null

  // Parse measurement jobs (handle both project export and job export)
  let measurementJobs: MeasurementJob[] = []
  if (data.measurementJobs) {
    measurementJobs = data.measurementJobs
  } else if (data.measurementJob) {
    measurementJobs = [data.measurementJob]
  }

  // Parse runs
  const runs: MeasurementRun[] = data.runs || []

  // Parse fixed point fields (handle both array and single)
  let fixedPointFields: FixedPointField[] = []
  if (data.fixedPointFields) {
    fixedPointFields = data.fixedPointFields
  } else if (data.fixedPointField) {
    fixedPointFields = [data.fixedPointField]
  }

  // Parse employees
  const employees: Employee[] = data.employees || []

  // Parse logo
  const logo: CompanyLogo | null = data.logo || null

  // Check for project conflict (by projectNumber)
  if (project) {
    const existingProject = await db.projects
      .filter(p => p.projectNumber === project.projectNumber)
      .first()
    if (existingProject) {
      conflicts.push({
        type: 'project',
        name: project.projectNumber,
        existingId: existingProject.id,
        importId: project.id
      })
    }
  }

  // Check for fixed point field conflicts (by name)
  for (const field of fixedPointFields) {
    const existingField = await db.fixedPointFields
      .filter(f => f.name === field.name)
      .first()
    if (existingField) {
      conflicts.push({
        type: 'fixedPointField',
        name: field.name,
        existingId: existingField.id,
        importId: field.id
      })
    }
  }

  // Check for employee conflicts (by name)
  for (const emp of employees) {
    const existingEmp = await db.employees
      .filter(e => e.name === emp.name)
      .first()
    if (existingEmp) {
      conflicts.push({
        type: 'employee',
        name: emp.name,
        existingId: existingEmp.id,
        importId: emp.id
      })
    }
  }

  // Check for logo conflict (by name)
  if (logo) {
    const existingLogo = await db.logos
      .filter(l => l.name === logo.name)
      .first()
    if (existingLogo) {
      conflicts.push({
        type: 'logo',
        name: logo.name,
        existingId: existingLogo.id,
        importId: logo.id
      })
    }
  }

  return {
    exportType,
    version: data.version || '1.0.0',
    project,
    measurementJobs,
    runs,
    fixedPointFields,
    employees,
    logo,
    conflicts,
    hasConflicts: conflicts.length > 0
  }
}

/**
 * Execute import with user decisions for conflicts.
 * Returns the new project ID.
 */
export async function executeImport(
  analysis: ImportAnalysis,
  decisions: ImportDecisions
): Promise<string> {
  const getDecision = (conflict: ImportConflict): ConflictResolution => {
    const key = `${conflict.type}-${conflict.importId}`
    return decisions[key] || 'rename'
  }

  // Build ID mapping tables
  const projectIdMap = new Map<string, string>()
  const jobIdMap = new Map<string, string>()
  const fieldIdMap = new Map<string, string>()
  const employeeIdMap = new Map<string, string>()
  const logoIdMap = new Map<string, string>()

  // Process conflicts and build mappings
  for (const conflict of analysis.conflicts) {
    const decision = getDecision(conflict)

    if (decision === 'overwrite') {
      // Use existing ID (will overwrite)
      switch (conflict.type) {
        case 'project':
          projectIdMap.set(conflict.importId, conflict.existingId)
          break
        case 'fixedPointField':
          fieldIdMap.set(conflict.importId, conflict.existingId)
          break
        case 'employee':
          employeeIdMap.set(conflict.importId, conflict.existingId)
          break
        case 'logo':
          logoIdMap.set(conflict.importId, conflict.existingId)
          break
      }
    } else if (decision === 'skip') {
      // Mark as skip (will use existing ID but not import data)
      switch (conflict.type) {
        case 'project':
          projectIdMap.set(conflict.importId, `skip:${conflict.existingId}`)
          break
        case 'fixedPointField':
          fieldIdMap.set(conflict.importId, `skip:${conflict.existingId}`)
          break
        case 'employee':
          employeeIdMap.set(conflict.importId, `skip:${conflict.existingId}`)
          break
        case 'logo':
          logoIdMap.set(conflict.importId, `skip:${conflict.existingId}`)
          break
      }
    }
    // For 'rename': no mapping needed, will generate new ID
  }

  // Generate new IDs for items without mapping (new items or renamed)
  let newProjectId = ''
  if (analysis.project) {
    const mappedId = projectIdMap.get(analysis.project.id)
    if (mappedId?.startsWith('skip:')) {
      // Project skipped, return existing ID
      return mappedId.replace('skip:', '')
    }
    newProjectId = mappedId || crypto.randomUUID()
    projectIdMap.set(analysis.project.id, newProjectId)
  }

  // Process employees first (needed for job references)
  const employeesToImport: Employee[] = []
  for (const emp of analysis.employees) {
    const mappedId = employeeIdMap.get(emp.id)
    if (mappedId?.startsWith('skip:')) {
      // Use existing employee ID for references
      employeeIdMap.set(emp.id, mappedId.replace('skip:', ''))
      continue
    }

    const newId = mappedId || crypto.randomUUID()
    employeeIdMap.set(emp.id, newId)

    // Find conflict to check if renaming needed
    const conflict = analysis.conflicts.find(c => c.type === 'employee' && c.importId === emp.id)
    const needsRename = conflict && getDecision(conflict) === 'rename'

    employeesToImport.push({
      ...emp,
      id: newId,
      name: needsRename ? `${emp.name} (Import)` : emp.name
    })
  }

  // Process logo
  let logoToImport: CompanyLogo | null = null
  if (analysis.logo) {
    const mappedId = logoIdMap.get(analysis.logo.id)
    if (!mappedId?.startsWith('skip:')) {
      const newId = mappedId || crypto.randomUUID()
      logoIdMap.set(analysis.logo.id, newId)

      const conflict = analysis.conflicts.find(c => c.type === 'logo' && c.importId === analysis.logo!.id)
      const needsRename = conflict && getDecision(conflict) === 'rename'

      logoToImport = {
        ...analysis.logo,
        id: newId,
        name: needsRename ? `${analysis.logo.name} (Import)` : analysis.logo.name
      }
    } else {
      // Use existing logo ID for project reference
      logoIdMap.set(analysis.logo.id, mappedId.replace('skip:', ''))
    }
  }

  // Process fixed point fields
  const fieldsToImport: FixedPointField[] = []
  for (const field of analysis.fixedPointFields) {
    const mappedId = fieldIdMap.get(field.id)
    if (mappedId?.startsWith('skip:')) {
      // Use existing field ID for job references
      fieldIdMap.set(field.id, mappedId.replace('skip:', ''))
      continue
    }

    const newId = mappedId || crypto.randomUUID()
    fieldIdMap.set(field.id, newId)

    const conflict = analysis.conflicts.find(c => c.type === 'fixedPointField' && c.importId === field.id)
    const needsRename = conflict && getDecision(conflict) === 'rename'

    fieldsToImport.push({
      ...field,
      id: newId,
      name: needsRename ? `${field.name} (Import)` : field.name
    })
  }

  // Process measurement jobs
  const jobsToImport: MeasurementJob[] = []
  for (const job of analysis.measurementJobs) {
    const newJobId = crypto.randomUUID()
    jobIdMap.set(job.id, newJobId)

    // Update references
    const updatedEmployeeIds = (job.employeeIds || []).map(id => employeeIdMap.get(id) || id)
    const updatedFieldId = job.fixedPointFieldId ? (fieldIdMap.get(job.fixedPointFieldId) || job.fixedPointFieldId) : undefined

    jobsToImport.push({
      ...job,
      id: newJobId,
      projectId: newProjectId,
      employeeIds: updatedEmployeeIds,
      fixedPointFieldId: updatedFieldId
    })
  }

  // Process runs
  const runsToImport: MeasurementRun[] = analysis.runs.map(run => ({
    ...run,
    id: crypto.randomUUID(),
    projectId: newProjectId,
    measurementJobId: jobIdMap.get(run.measurementJobId) || run.measurementJobId
  }))

  // Prepare project with updated references
  let projectToImport: Project | null = null
  if (analysis.project) {
    const conflict = analysis.conflicts.find(c => c.type === 'project')
    const needsRename = conflict && getDecision(conflict) === 'rename'
    const updatedLogoId = analysis.project.logoId ? (logoIdMap.get(analysis.project.logoId) || analysis.project.logoId) : undefined

    projectToImport = {
      ...analysis.project,
      id: newProjectId,
      projectNumber: needsRename ? `${analysis.project.projectNumber} (Import)` : analysis.project.projectNumber,
      logoId: updatedLogoId
    }
  }

  // Debug logging
  console.log('executeImport:', {
    jobsToImport: jobsToImport.length,
    runsToImport: runsToImport.length,
    fieldsToImport: fieldsToImport.length,
    employeesToImport: employeesToImport.length,
    newProjectId
  })

  // Execute database transaction
  await db.transaction('rw', [db.projects, db.measurementJobs, db.runs, db.fixedPointFields, db.employees, db.logos], async () => {
    // Import/update employees
    for (const emp of employeesToImport) {
      const existing = await db.employees.get(emp.id)
      if (existing) {
        await db.employees.update(emp.id, emp)
      } else {
        await db.employees.add(emp)
      }
    }

    // Import/update logo
    if (logoToImport) {
      const existing = await db.logos.get(logoToImport.id)
      if (existing) {
        await db.logos.update(logoToImport.id, logoToImport)
      } else {
        await db.logos.add(logoToImport)
      }
    }

    // Import/update fixed point fields
    for (const field of fieldsToImport) {
      const existing = await db.fixedPointFields.get(field.id)
      if (existing) {
        await db.fixedPointFields.update(field.id, field)
      } else {
        await db.fixedPointFields.add(field)
      }
    }

    // Import/update project
    if (projectToImport) {
      const existing = await db.projects.get(projectToImport.id)
      if (existing) {
        // Overwrite: delete old jobs and runs first
        const oldJobs = await db.measurementJobs.where('projectId').equals(projectToImport.id).toArray()
        for (const oldJob of oldJobs) {
          await db.runs.where('measurementJobId').equals(oldJob.id).delete()
        }
        await db.measurementJobs.where('projectId').equals(projectToImport.id).delete()
        await db.projects.update(projectToImport.id, projectToImport)
      } else {
        await db.projects.add(projectToImport)
      }
    }

    // Import jobs
    for (const job of jobsToImport) {
      await db.measurementJobs.add(job)
    }

    // Import runs
    for (const run of runsToImport) {
      await db.runs.add(run)
    }
  })

  return newProjectId
}
