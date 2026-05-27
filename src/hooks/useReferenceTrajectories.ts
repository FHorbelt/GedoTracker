import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { ReferenceTrajectory, TrajectoryPoint } from '../db/models'
import { v4 as uuidv4 } from 'uuid'

export function useReferenceTrajectories() {
  const trajectories = useLiveQuery(() =>
    db.referenceTrajectories.orderBy('createdAt').reverse().toArray()
  )

  const isLoading = trajectories === undefined

  return { trajectories: trajectories || [], isLoading }
}

/**
 * Returns trajectories matching a specific fixedPointFieldId PLUS global ones (without field).
 * If fieldId is undefined, returns all trajectories (backwards-compatible).
 */
export function useReferenceTrajectoriesForField(fieldId?: string) {
  const trajectories = useLiveQuery(
    () => {
      if (!fieldId) {
        // No field filter — return all trajectories
        return db.referenceTrajectories.orderBy('createdAt').reverse().toArray()
      }
      // Return trajectories linked to this field + global (no fixedPointFieldId)
      return db.referenceTrajectories
        .orderBy('createdAt')
        .reverse()
        .filter(t => !t.fixedPointFieldId || t.fixedPointFieldId === fieldId)
        .toArray()
    },
    [fieldId]
  )

  const isLoading = trajectories === undefined

  return { trajectories: trajectories || [], isLoading }
}

export function useReferenceTrajectory(id?: string) {
  const trajectory = useLiveQuery(
    () => id ? db.referenceTrajectories.get(id) : undefined,
    [id]
  )

  const isLoading = trajectory === undefined && id !== undefined

  return { trajectory, isLoading }
}

export async function createReferenceTrajectory(
  name: string,
  points: TrajectoryPoint[],
  fixedPointFieldId?: string
): Promise<string> {
  const id = uuidv4()
  const now = new Date().toISOString()

  const trajectory: ReferenceTrajectory = {
    id,
    name,
    points,
    fixedPointFieldId,
    createdAt: now,
    updatedAt: now
  }

  await db.referenceTrajectories.add(trajectory)
  return id
}

export async function deleteReferenceTrajectory(id: string): Promise<void> {
  await db.referenceTrajectories.delete(id)
}

export async function deleteReferenceTrajectoriesByField(fieldId: string): Promise<void> {
  await db.referenceTrajectories.where('fixedPointFieldId').equals(fieldId).delete()
}
