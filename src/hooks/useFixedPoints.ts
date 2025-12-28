import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { FixedPointField, FixedPoint } from '../db/models'
import { v4 as uuidv4 } from 'uuid'

export function useFixedPointFields() {
  const fields = useLiveQuery(() => 
    db.fixedPointFields.orderBy('name').toArray()
  )

  const isLoading = fields === undefined

  return { fields: fields || [], isLoading }
}

export function useFixedPointField(id: string | undefined) {
  const field = useLiveQuery(
    () => id ? db.fixedPointFields.get(id) : undefined,
    [id]
  )

  const isLoading = field === undefined && id !== undefined

  return { field, isLoading }
}

export async function createFixedPointField(name: string, points: FixedPoint[]): Promise<string> {
  const now = new Date().toISOString()
  const field: FixedPointField = {
    id: uuidv4(),
    name,
    points,
    createdAt: now,
    updatedAt: now
  }

  await db.fixedPointFields.add(field)
  return field.id
}

export async function updateFixedPointField(id: string, data: Partial<FixedPointField>): Promise<void> {
  await db.fixedPointFields.update(id, {
    ...data,
    updatedAt: new Date().toISOString()
  })
}

export async function deleteFixedPointField(id: string): Promise<void> {
  await db.fixedPointFields.delete(id)
}

export async function addPointsToField(fieldId: string, newPoints: FixedPoint[]): Promise<void> {
  const field = await db.fixedPointFields.get(fieldId)
  if (!field) throw new Error('Field not found')

  await db.fixedPointFields.update(fieldId, {
    points: [...field.points, ...newPoints],
    updatedAt: new Date().toISOString()
  })
}
