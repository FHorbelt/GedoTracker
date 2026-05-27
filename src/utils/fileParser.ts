import { FixedPoint, TrajectoryPoint } from '../db/models'
import { v4 as uuidv4 } from 'uuid'
import { unzipSync } from 'fflate'

export interface ParseResult {
  success: boolean
  points: FixedPoint[]
  errors: string[]
  fileName: string
}

export interface TrajectoryParseResult {
  name: string
  points: TrajectoryPoint[]
  segments?: TrajectoryPoint[][]
}

export interface KmlParseResult {
  success: boolean
  fixedPoints: FixedPoint[]
  trajectories: TrajectoryParseResult[]
  errors: string[]
  fileName: string
}

/**
 * Parse a KML or KMZ file containing fixed points
 * Automatically detects format based on file extension
 */
export async function parseFixedPointFile(file: File): Promise<ParseResult> {
  const isKmz = file.name.toLowerCase().endsWith('.kmz')

  if (isKmz) {
    return parseKmzFile(file)
  } else {
    return parseKmlFile(file)
  }
}

/**
 * Parse a KMZ file (ZIP archive containing KML)
 */
async function parseKmzFile(file: File): Promise<ParseResult> {
  const result: ParseResult = {
    success: false,
    points: [],
    errors: [],
    fileName: file.name.replace(/\.kmz$/i, '')
  }

  try {
    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)

    // Unzip the KMZ file
    let unzipped: Record<string, Uint8Array>
    try {
      unzipped = unzipSync(uint8Array)
    } catch (e) {
      result.errors.push('Ungültiges KMZ-Format: Datei konnte nicht entpackt werden')
      return result
    }

    // Find the KML file inside (usually doc.kml or *.kml)
    let kmlContent: string | null = null
    let kmlFileName: string | null = null

    // First try doc.kml (standard), then any .kml file
    for (const [filename, content] of Object.entries(unzipped)) {
      if (filename.toLowerCase() === 'doc.kml') {
        kmlContent = new TextDecoder().decode(content)
        kmlFileName = filename
        break
      }
    }

    // If no doc.kml, find any .kml file
    if (!kmlContent) {
      for (const [filename, content] of Object.entries(unzipped)) {
        if (filename.toLowerCase().endsWith('.kml')) {
          kmlContent = new TextDecoder().decode(content)
          kmlFileName = filename
          break
        }
      }
    }

    if (!kmlContent) {
      result.errors.push('Keine KML-Datei im KMZ-Archiv gefunden')
      return result
    }

    // Parse the KML content
    return parseKmlContent(kmlContent, result.fileName)

  } catch (error) {
    result.errors.push(`Fehler beim Lesen der KMZ-Datei: ${error}`)
    return result
  }
}

/**
 * Parse a KML file from File object
 */
async function parseKmlFile(file: File): Promise<ParseResult> {
  const fileName = file.name.replace(/\.kml$/i, '')

  try {
    const text = await file.text()
    return parseKmlContent(text, fileName)
  } catch (error) {
    return {
      success: false,
      points: [],
      errors: [`Fehler beim Lesen der Datei: ${error}`],
      fileName
    }
  }
}

/**
 * Parse KML content string
 * Expected structure:
 * <kml>
 *   <Folder>
 *     <name>Field Name</name>
 *     <Placemark>
 *       <name>Point Number</name>
 *       <description>Type info</description>
 *       <Point>
 *         <coordinates>lon,lat,elevation</coordinates>
 *       </Point>
 *     </Placemark>
 *     ...
 *   </Folder>
 * </kml>
 */
function parseKmlContent(kmlText: string, defaultFileName: string): ParseResult {
  const result: ParseResult = {
    success: false,
    points: [],
    errors: [],
    fileName: defaultFileName
  }

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(kmlText, 'application/xml')

    // Check for parsing errors
    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      result.errors.push('Ungültiges XML-Format: ' + parseError.textContent?.substring(0, 100))
      return result
    }

    // Try to get folder name as field name
    const folder = doc.querySelector('Folder')
    if (folder) {
      const folderName = folder.querySelector(':scope > name')?.textContent
      if (folderName) {
        result.fileName = folderName
      }
    }

    // Find all Placemarks
    const placemarks = doc.querySelectorAll('Placemark')

    if (placemarks.length === 0) {
      result.errors.push('Keine Placemarks in der KML-Datei gefunden')
      return result
    }

    let pointIndex = 0
    placemarks.forEach((placemark) => {
      pointIndex++

      // Get point number from <name>
      const nameElement = placemark.querySelector('name')
      const pointNumber = nameElement?.textContent?.trim()

      if (!pointNumber) {
        result.errors.push(`Placemark ${pointIndex}: Punktnummer fehlt`)
        return
      }

      // Get coordinates from <Point><coordinates>
      const coordsElement = placemark.querySelector('Point coordinates')
      const coordsText = coordsElement?.textContent?.trim()

      if (!coordsText) {
        result.errors.push(`Punkt ${pointNumber}: Keine Koordinaten gefunden`)
        return
      }

      // Parse coordinates (format: lon,lat,elevation)
      const parts = coordsText.split(',').map(s => s.trim())

      if (parts.length < 2) {
        result.errors.push(`Punkt ${pointNumber}: Ungültiges Koordinatenformat`)
        return
      }

      const longitude = parseFloat(parts[0])
      const latitude = parseFloat(parts[1])
      const elevation = parts.length > 2 ? parseFloat(parts[2]) : 0

      if (isNaN(longitude) || isNaN(latitude)) {
        result.errors.push(`Punkt ${pointNumber}: Ungültige Koordinatenwerte`)
        return
      }

      // Validate coordinate ranges
      if (longitude < -180 || longitude > 180) {
        result.errors.push(`Punkt ${pointNumber}: Längengrad außerhalb des gültigen Bereichs (-180 bis 180)`)
        return
      }

      if (latitude < -90 || latitude > 90) {
        result.errors.push(`Punkt ${pointNumber}: Breitengrad außerhalb des gültigen Bereichs (-90 bis 90)`)
        return
      }

      // Extract type from description (if available)
      // Format: "Code: 112, Marker type: none" -> extract "112"
      let type = ''
      const descElement = placemark.querySelector('description')
      const descText = descElement?.textContent || ''

      const codeMatch = descText.match(/Code:\s*(\d+)/)
      if (codeMatch) {
        type = codeMatch[1]
      }

      result.points.push({
        id: uuidv4(),
        pointNumber,
        longitude,
        latitude,
        elevation: isNaN(elevation) ? 0 : elevation,
        type
      })
    })

    result.success = result.points.length > 0

  } catch (error) {
    result.errors.push(`Fehler beim Parsen: ${error}`)
  }

  return result
}

/**
 * Parse a KML or KMZ file and extract both fixed points (from <Point>) and
 * reference trajectories (from <LineString>).
 */
export async function parseKmlMixed(file: File): Promise<KmlParseResult> {
  const isKmz = file.name.toLowerCase().endsWith('.kmz')
  const defaultFileName = file.name.replace(/\.(kml|kmz)$/i, '')

  let kmlText: string
  if (isKmz) {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      const unzipped = unzipSync(uint8Array)

      let kmlContent: string | null = null
      for (const [filename, content] of Object.entries(unzipped)) {
        if (filename.toLowerCase() === 'doc.kml') {
          kmlContent = new TextDecoder().decode(content)
          break
        }
      }
      if (!kmlContent) {
        for (const [filename, content] of Object.entries(unzipped)) {
          if (filename.toLowerCase().endsWith('.kml')) {
            kmlContent = new TextDecoder().decode(content)
            break
          }
        }
      }
      if (!kmlContent) {
        return { success: false, fixedPoints: [], trajectories: [], errors: ['Keine KML-Datei im KMZ-Archiv gefunden'], fileName: defaultFileName }
      }
      kmlText = kmlContent
    } catch (error) {
      return { success: false, fixedPoints: [], trajectories: [], errors: [`Fehler beim Lesen der KMZ-Datei: ${error}`], fileName: defaultFileName }
    }
  } else {
    try {
      kmlText = await file.text()
    } catch (error) {
      return { success: false, fixedPoints: [], trajectories: [], errors: [`Fehler beim Lesen der Datei: ${error}`], fileName: defaultFileName }
    }
  }

  return parseKmlContentMixed(kmlText, defaultFileName)
}

/**
 * Parse KML content and extract both Point and LineString elements
 */
function parseKmlContentMixed(kmlText: string, defaultFileName: string): KmlParseResult {
  const result: KmlParseResult = {
    success: false,
    fixedPoints: [],
    trajectories: [],
    errors: [],
    fileName: defaultFileName
  }

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(kmlText, 'application/xml')

    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      result.errors.push('Ungültiges XML-Format: ' + parseError.textContent?.substring(0, 100))
      return result
    }

    // Try to get folder name as field name
    const folder = doc.querySelector('Folder')
    if (folder) {
      const folderName = folder.querySelector(':scope > name')?.textContent
      if (folderName) {
        result.fileName = folderName
      }
    }

    const placemarks = doc.querySelectorAll('Placemark')
    if (placemarks.length === 0) {
      result.errors.push('Keine Placemarks in der KML-Datei gefunden')
      return result
    }

    let trajectoryCounter = 0

    placemarks.forEach((placemark) => {
      const nameElement = placemark.querySelector('name')
      const placemarkName = nameElement?.textContent?.trim() || ''

      // Check for LineString / MultiGeometry (trajectory)
      const lineStrings = placemark.querySelectorAll('LineString')
      if (lineStrings.length > 0) {
        // Collect all coordinate arrays from every LineString in this Placemark
        const segments: TrajectoryPoint[][] = []
        lineStrings.forEach((ls) => {
          const coordsText = ls.querySelector('coordinates')?.textContent?.trim()
          if (coordsText) {
            const pts = parseLineStringCoordinates(coordsText)
            if (pts.length > 0) segments.push(pts)
          }
        })

        // Merge chained segments; disconnected sections become separate sub-polylines
        const subPolylines = mergeTrajectorySegments(segments)
        const validSubs = subPolylines.filter(sp => sp.length >= 2)

        if (validSubs.length === 0) {
          result.errors.push(`LineString "${placemarkName}": Zu wenige Koordinaten`)
        } else {
          trajectoryCounter++
          result.trajectories.push({
            name: placemarkName || `Trasse ${trajectoryCounter}`,
            points: validSubs.flat(),   // flat array for spline / legacy use
            segments: validSubs         // sub-polylines for clean multi-polyline rendering
          })
        }
        return // Don't also parse as point
      }

      // Check for Point (fixed point)
      const pointElement = placemark.querySelector('Point')
      if (pointElement) {
        const coordsElement = pointElement.querySelector('coordinates')
        const coordsText = coordsElement?.textContent?.trim()
        if (!coordsText) {
          result.errors.push(`Punkt "${placemarkName}": Keine Koordinaten gefunden`)
          return
        }

        const parts = coordsText.split(',').map(s => s.trim())
        if (parts.length < 2) {
          result.errors.push(`Punkt "${placemarkName}": Ungültiges Koordinatenformat`)
          return
        }

        const longitude = parseFloat(parts[0])
        const latitude = parseFloat(parts[1])
        const elevation = parts.length > 2 ? parseFloat(parts[2]) : 0

        if (isNaN(longitude) || isNaN(latitude)) {
          result.errors.push(`Punkt "${placemarkName}": Ungültige Koordinatenwerte`)
          return
        }
        if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
          result.errors.push(`Punkt "${placemarkName}": Koordinaten außerhalb des gültigen Bereichs`)
          return
        }

        let type = ''
        const descElement = placemark.querySelector('description')
        const descText = descElement?.textContent || ''
        const codeMatch = descText.match(/Code:\s*(\d+)/)
        if (codeMatch) {
          type = codeMatch[1]
        }

        result.fixedPoints.push({
          id: uuidv4(),
          pointNumber: placemarkName,
          longitude,
          latitude,
          elevation: isNaN(elevation) ? 0 : elevation,
          type
        })
      }
    })

    result.success = result.fixedPoints.length > 0 || result.trajectories.length > 0
  } catch (error) {
    result.errors.push(`Fehler beim Parsen: ${error}`)
  }

  return result
}

// ~11 m in degree space — bridges floating-point endpoint mismatches in KML exports
// while still splitting at genuine geographic discontinuities (e.g. 37 km jumps).
const CHAIN_THRESHOLD_DEG = 1e-4

/**
 * Merge a list of TrajectoryPoint arrays into connected sub-polylines.
 * Consecutive segments whose endpoints are within CHAIN_THRESHOLD_DEG of each other
 * are chained together (the near-duplicate start point is dropped).
 * Segments with larger endpoint gaps start a new sub-polyline.
 * Returns one array per connected section.
 */
function mergeTrajectorySegments(segments: TrajectoryPoint[][]): TrajectoryPoint[][] {
  if (segments.length === 0) return []

  const subPolylines: TrajectoryPoint[][] = []
  let current: TrajectoryPoint[] = [...segments[0]]

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]
    if (seg.length === 0) continue
    const last = current[current.length - 1]
    const first = seg[0]
    const dLon = Math.abs(last.lon - first.lon)
    const dLat = Math.abs(last.lat - first.lat)

    if (dLon < CHAIN_THRESHOLD_DEG && dLat < CHAIN_THRESHOLD_DEG) {
      // Endpoints are close enough — chain by dropping the near-duplicate start point
      current.push(...seg.slice(1))
    } else {
      // Genuine geographic gap — start a new sub-polyline
      subPolylines.push(current)
      current = [...seg]
    }
  }
  subPolylines.push(current)
  return subPolylines
}

/**
 * Parse a LineString coordinates string into TrajectoryPoints
 * Format: "lon,lat,elev lon,lat,elev ..." (space or newline separated)
 */
function parseLineStringCoordinates(coordsText: string): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = []
  // Split by whitespace (spaces, newlines, tabs)
  const tuples = coordsText.split(/\s+/).filter(s => s.length > 0)

  for (const tuple of tuples) {
    const parts = tuple.split(',')
    if (parts.length < 2) continue

    const lon = parseFloat(parts[0])
    const lat = parseFloat(parts[1])
    const elevation = parts.length > 2 ? parseFloat(parts[2]) : undefined

    if (isNaN(lon) || isNaN(lat)) continue

    points.push({
      lon,
      lat,
      elevation: elevation !== undefined && !isNaN(elevation) ? elevation : undefined
    })
  }

  return points
}

/**
 * Export fixed points to KML format
 */
export function exportFixedPointsToKML(points: FixedPoint[], fieldName: string): string {
  const placemarks = points.map(p => `
    <Placemark>
      <name>${escapeXml(p.pointNumber)}</name>
      <description><![CDATA[Code: ${escapeXml(p.type || 'unknown')}]]></description>
      <Point>
        <coordinates>${p.longitude.toFixed(10)},${p.latitude.toFixed(10)},${p.elevation.toFixed(4)}</coordinates>
      </Point>
    </Placemark>`).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Folder>
    <name>${escapeXml(fieldName)}</name>${placemarks}
  </Folder>
</kml>`
}

/**
 * Escape special XML characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

