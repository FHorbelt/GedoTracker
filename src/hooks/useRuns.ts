import { useLiveQuery } from 'dexie-react-hooks'
import { db, getNextRunNumber } from '../db/database'
import { MeasurementRun } from '../db/models'
import { v4 as uuidv4 } from 'uuid'

// Legacy: Runs nach projectId (für Abwärtskompatibilität)
export function useRuns(projectId: string | undefined) {
  const runs = useLiveQuery(
    () => projectId
      ? db.runs.where('projectId').equals(projectId).sortBy('runNumber')
      : [],
    [projectId]
  )

  const isLoading = runs === undefined && projectId !== undefined

  return { runs: runs || [], isLoading }
}

// NEU: Runs nach measurementJobId
export function useRunsByJob(jobId: string | undefined) {
  const runs = useLiveQuery(
    () => jobId
      ? db.runs.where('measurementJobId').equals(jobId).sortBy('runNumber')
      : [],
    [jobId]
  )

  const isLoading = runs === undefined && jobId !== undefined

  return { runs: runs || [], isLoading }
}

export function useRun(id: string | undefined) {
  const run = useLiveQuery(
    () => id ? db.runs.get(id) : undefined,
    [id]
  )

  const isLoading = run === undefined && id !== undefined

  return { run, isLoading }
}

// NEU: createRun benötigt jetzt projectId UND measurementJobId
export async function createRun(
  projectId: string,
  measurementJobId: string,
  data: Omit<MeasurementRun, 'id' | 'projectId' | 'measurementJobId' | 'runNumber' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const now = new Date().toISOString()
  const runNumber = await getNextRunNumber(measurementJobId)

  const run: MeasurementRun = {
    ...data,
    id: uuidv4(),
    projectId,
    measurementJobId,
    runNumber,
    createdAt: now,
    updatedAt: now
  }

  await db.runs.add(run)
  return run.id
}

export async function updateRun(id: string, data: Partial<MeasurementRun>): Promise<void> {
  await db.runs.update(id, {
    ...data,
    updatedAt: new Date().toISOString()
  })
}

export async function deleteRun(id: string): Promise<void> {
  await db.runs.delete(id)
}

// Legacy: Letzter Run-Name nach projectId
export async function getLastRunName(projectId: string): Promise<string | null> {
  const runs = await db.runs
    .where('projectId')
    .equals(projectId)
    .reverse()
    .sortBy('runNumber')

  return runs.length > 0 ? runs[0].runName : null
}

// NEU: Letzter Run nach measurementJobId
export async function getLastRunInJob(measurementJobId: string): Promise<MeasurementRun | null> {
  const runs = await db.runs
    .where('measurementJobId')
    .equals(measurementJobId)
    .reverse()
    .sortBy('runNumber')

  return runs.length > 0 ? runs[0] : null
}

// Legacy: Letzter Run nach projectId (für Abwärtskompatibilität)
export async function getLastRun(projectId: string): Promise<MeasurementRun | null> {
  const runs = await db.runs
    .where('projectId')
    .equals(projectId)
    .reverse()
    .sortBy('runNumber')

  return runs.length > 0 ? runs[0] : null
}
