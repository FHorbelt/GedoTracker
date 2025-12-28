import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { TargetBoard } from '../db/models'
import { v4 as uuidv4 } from 'uuid'

export function useTargetBoards() {
  const targetBoards = useLiveQuery(
    () => db.targetBoards.orderBy('name').toArray(),
    []
  )

  const isLoading = targetBoards === undefined

  return { targetBoards: targetBoards || [], isLoading }
}

export async function addCustomTargetBoard(
  sideLength: number,
  boardHeight: number,
  boardThickness: number
): Promise<string> {
  const name = `${sideLength}mm / ${boardHeight}mm / ${boardThickness}mm`

  // Check if this combination already exists
  const existing = await db.targetBoards
    .filter(tb =>
      tb.sideLength === sideLength &&
      tb.boardHeight === boardHeight &&
      tb.boardThickness === boardThickness
    )
    .first()

  if (existing) {
    return existing.id
  }

  const id = uuidv4()
  const targetBoard: TargetBoard = {
    id,
    name,
    sideLength,
    boardHeight,
    boardThickness,
    isCustom: true,
    createdAt: new Date().toISOString()
  }

  await db.targetBoards.add(targetBoard)
  return id
}

export async function deleteCustomTargetBoard(id: string): Promise<void> {
  const board = await db.targetBoards.get(id)
  if (board && board.isCustom) {
    await db.targetBoards.delete(id)
  }
}

export async function getTargetBoard(id: string): Promise<TargetBoard | undefined> {
  return db.targetBoards.get(id)
}
