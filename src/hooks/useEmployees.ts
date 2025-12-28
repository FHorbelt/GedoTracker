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

export async function addEmployee(name: string): Promise<string> {
  const employee: Employee = {
    id: uuidv4(),
    name,
    createdAt: new Date().toISOString()
  }

  await db.employees.add(employee)
  return employee.id
}

export async function deleteEmployee(id: string): Promise<void> {
  await db.employees.delete(id)
}

export async function updateEmployee(id: string, name: string): Promise<void> {
  await db.employees.update(id, { name })
}
