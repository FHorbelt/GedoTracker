import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { CompanyLogo } from '../db/models'
import { v4 as uuidv4 } from 'uuid'

// Get all logos
export function useLogos() {
  const logos = useLiveQuery(() => db.logos.orderBy('createdAt').toArray()) || []
  return { logos }
}

// Get a single logo by ID
export function useLogo(logoId?: string) {
  const logo = useLiveQuery(
    () => logoId ? db.logos.get(logoId) : undefined,
    [logoId]
  )
  return { logo }
}

// Get the default logo
export function useDefaultLogo() {
  const logo = useLiveQuery(() => db.logos.filter(l => l.isDefault).first())
  return { defaultLogo: logo }
}

// Add a new logo
export async function addLogo(name: string, imageData: string, mimeType: string): Promise<string> {
  const id = uuidv4()

  // Check if this should be the default (first logo)
  const existingCount = await db.logos.count()
  const isDefault = existingCount === 0

  await db.logos.add({
    id,
    name,
    imageData,
    mimeType,
    isDefault,
    createdAt: new Date().toISOString()
  })

  return id
}

// Update a logo
export async function updateLogo(id: string, updates: Partial<CompanyLogo>) {
  await db.logos.update(id, updates)
}

// Set a logo as default
export async function setDefaultLogo(id: string) {
  await db.transaction('rw', db.logos, async () => {
    // Remove default from all logos
    await db.logos.toCollection().modify({ isDefault: false })
    // Set the new default
    await db.logos.update(id, { isDefault: true })
  })
}

// Delete a logo
export async function deleteLogo(id: string) {
  const logo = await db.logos.get(id)
  if (!logo) return

  await db.logos.delete(id)

  // If this was the default, set the first remaining logo as default
  if (logo.isDefault) {
    const firstLogo = await db.logos.orderBy('createdAt').first()
    if (firstLogo) {
      await db.logos.update(firstLogo.id, { isDefault: true })
    }
  }
}

// Convert File to base64
export function fileToBase64(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Remove data:image/xxx;base64, prefix to get pure base64
      const base64 = result.split(',')[1]
      resolve({ data: base64, mimeType: file.type })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Get logo as data URL for display
export function getLogoDataUrl(logo: CompanyLogo): string {
  return `data:${logo.mimeType};base64,${logo.imageData}`
}
