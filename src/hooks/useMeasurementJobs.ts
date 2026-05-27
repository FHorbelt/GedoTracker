import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { MeasurementJob } from '../db/models'
import { v4 as uuidv4 } from 'uuid'

// Alle Messjobs laden (ohne Projektfilter)
export function useAllMeasurementJobs() {
  const jobs = useLiveQuery(
    () => db.measurementJobs.orderBy('createdAt').reverse().toArray()
  )

  const isLoading = jobs === undefined

  return { jobs: jobs || [], isLoading }
}

// Alle Messjobs eines Projekts laden
export function useMeasurementJobs(projectId: string | undefined) {
  const jobs = useLiveQuery(
    () => projectId
      ? db.measurementJobs.where('projectId').equals(projectId).sortBy('createdAt')
      : [],
    [projectId]
  )

  const isLoading = jobs === undefined && projectId !== undefined

  return { jobs: jobs || [], isLoading }
}

// Einzelnen Messjob laden
export function useMeasurementJob(id: string | undefined) {
  const job = useLiveQuery(
    () => id ? db.measurementJobs.get(id) : undefined,
    [id]
  )

  const isLoading = job === undefined && id !== undefined

  return { job, isLoading }
}

// Messjob mit allen Runs laden
export function useMeasurementJobWithRuns(id: string | undefined) {
  const job = useLiveQuery(
    () => id ? db.measurementJobs.get(id) : undefined,
    [id]
  )

  const runs = useLiveQuery(
    () => id ? db.runs.where('measurementJobId').equals(id).sortBy('runNumber') : [],
    [id]
  )

  const isLoading = (job === undefined || runs === undefined) && id !== undefined

  return { job, runs: runs || [], isLoading }
}

// Messjob erstellen
export async function createMeasurementJob(
  projectId: string,
  data: Omit<MeasurementJob, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const now = new Date().toISOString()

  const job: MeasurementJob = {
    ...data,
    id: uuidv4(),
    projectId,
    createdAt: now,
    updatedAt: now
  }

  await db.measurementJobs.add(job)
  return job.id
}

// Messjob aktualisieren
export async function updateMeasurementJob(id: string, data: Partial<MeasurementJob>): Promise<void> {
  await db.measurementJobs.update(id, {
    ...data,
    updatedAt: new Date().toISOString()
  })
}

// Messjob löschen (mit allen Runs)
export async function deleteMeasurementJob(id: string): Promise<void> {
  await db.transaction('rw', [db.measurementJobs, db.runs], async () => {
    await db.runs.where('measurementJobId').equals(id).delete()
    await db.measurementJobs.delete(id)
  })
}

// Letzten Messjob eines Projekts laden (für Übernahme von Einstellungen)
export async function getLastMeasurementJob(projectId: string): Promise<MeasurementJob | null> {
  const jobs = await db.measurementJobs
    .where('projectId')
    .equals(projectId)
    .reverse()
    .sortBy('createdAt')

  return jobs.length > 0 ? jobs[0] : null
}

// Anzahl der Runs in einem Messjob
export function useJobRunCount(jobId: string | undefined) {
  const count = useLiveQuery(
    () => jobId ? db.runs.where('measurementJobId').equals(jobId).count() : 0,
    [jobId]
  )

  return count || 0
}
