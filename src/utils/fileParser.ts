import { FixedPoint } from '../db/models'
import { v4 as uuidv4 } from 'uuid'

export interface ParseResult {
  success: boolean
  points: FixedPoint[]
  errors: string[]
  fileName: string
}

/**
 * Parse a CSV or TXT file containing fixed points
 * Expected format: Punktnummer,Rechtswert,Hochwert,Höhe,Art
 */
export async function parseFixedPointFile(file: File): Promise<ParseResult> {
  const result: ParseResult = {
    success: false,
    points: [],
    errors: [],
    fileName: file.name.replace(/\.(csv|txt)$/i, '')
  }

  try {
    const text = await file.text()
    const lines = text.split(/\r?\n/).filter(line => line.trim())
    
    // Check if first line is a header
    let startLine = 0
    const firstLine = lines[0]?.toLowerCase() || ''
    if (firstLine.includes('punktnummer') || 
        firstLine.includes('pointnumber') ||
        firstLine.includes('rechtswert') ||
        firstLine.includes('easting')) {
      startLine = 1
    }

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      // Try different delimiters
      let parts: string[] = []
      if (line.includes(';')) {
        parts = line.split(';')
      } else if (line.includes(',')) {
        parts = line.split(',')
      } else if (line.includes('\t')) {
        parts = line.split('\t')
      } else {
        parts = line.split(/\s+/)
      }

      if (parts.length < 4) {
        result.errors.push(`Zeile ${i + 1}: Ungültiges Format (mindestens 4 Spalten erwartet)`)
        continue
      }

      const pointNumber = parts[0].trim()
      const easting = parseFloat(parts[1].replace(',', '.'))
      const northing = parseFloat(parts[2].replace(',', '.'))
      const elevation = parseFloat(parts[3].replace(',', '.'))
      const type = parts[4]?.trim() || ''

      if (!pointNumber) {
        result.errors.push(`Zeile ${i + 1}: Punktnummer fehlt`)
        continue
      }

      if (isNaN(easting) || isNaN(northing) || isNaN(elevation)) {
        result.errors.push(`Zeile ${i + 1}: Ungültige Koordinaten`)
        continue
      }

      result.points.push({
        id: uuidv4(),
        pointNumber,
        easting,
        northing,
        elevation,
        type
      })
    }

    result.success = result.points.length > 0

  } catch (error) {
    result.errors.push(`Fehler beim Lesen der Datei: ${error}`)
  }

  return result
}

/**
 * Export fixed points to CSV format
 */
export function exportFixedPointsToCSV(points: FixedPoint[]): string {
  const header = 'Punktnummer;Rechtswert;Hochwert;Höhe;Art'
  const rows = points.map(p => 
    `${p.pointNumber};${p.easting.toFixed(4)};${p.northing.toFixed(4)};${p.elevation.toFixed(4)};${p.type}`
  )
  return [header, ...rows].join('\n')
}
