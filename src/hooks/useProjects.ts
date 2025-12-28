import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { Project } from '../db/models'
import { v4 as uuidv4 } from 'uuid'

export function useProjects() {
  const projects = useLiveQuery(() => 
    db.projects.orderBy('createdAt').reverse().toArray()
  )

  const isLoading = projects === undefined

  return { projects: projects || [], isLoading }
}

export function useProject(id: string | undefined) {
  const project = useLiveQuery(
    () => id ? db.projects.get(id) : undefined,
    [id]
  )

  const isLoading = project === undefined && id !== undefined

  return { project, isLoading }
}

export function useProjectWithRuns(id: string | undefined) {
  const project = useLiveQuery(
    () => id ? db.projects.get(id) : undefined,
    [id]
  )

  const runs = useLiveQuery(
    () => id ? db.runs.where('projectId').equals(id).sortBy('runNumber') : [],
    [id]
  )

  const isLoading = (project === undefined || runs === undefined) && id !== undefined

  return { project, runs: runs || [], isLoading }
}

export async function createProject(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const now = new Date().toISOString()
  const project: Project = {
    ...data,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now
  }

  await db.projects.add(project)
  return project.id
}

export async function updateProject(id: string, data: Partial<Project>): Promise<void> {
  await db.projects.update(id, {
    ...data,
    updatedAt: new Date().toISOString()
  })
}

export async function deleteProject(id: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.runs], async () => {
    await db.runs.where('projectId').equals(id).delete()
    await db.projects.delete(id)
  })
}
