import { FixedPoint, TrackedPoint } from '../db/models'

interface ReferencePoint {
  pointId: string
  pointNumber: string
  kmValue: number
  localDistance: number // Distance from run start in meters
  easting: number
  northing: number
}

/**
 * Calculate the distance between two points in GK/DBREF coordinates
 */
export function calculateDistance(
  easting1: number, 
  northing1: number, 
  easting2: number, 
  northing2: number
): number {
  const dE = easting2 - easting1
  const dN = northing2 - northing1
  return Math.sqrt(dE * dE + dN * dN)
}

/**
 * Calculate KM values for all points between reference points
 * using linear interpolation
 */
export function interpolateKmValues(
  allPoints: FixedPoint[],
  referencePoints: ReferencePoint[],
  _startKm: number,
  _endKm?: number
): TrackedPoint[] {
  if (referencePoints.length < 2) {
    console.warn('Need at least 2 reference points for interpolation')
    return []
  }

  // Sort reference points by local distance
  const sortedRefs = [...referencePoints].sort((a, b) => a.localDistance - b.localDistance)
  
  // Calculate the km per meter ratio from reference points
  const firstRef = sortedRefs[0]
  const lastRef = sortedRefs[sortedRefs.length - 1]
  
  const distanceDelta = lastRef.localDistance - firstRef.localDistance
  const kmDelta = lastRef.kmValue - firstRef.kmValue
  
  if (distanceDelta === 0) {
    console.warn('Reference points have same distance')
    return []
  }

  const kmPerMeter = kmDelta / distanceDelta

  // Find all points that lie between the first and last reference points
  // by projecting them onto the track line
  const result: TrackedPoint[] = []
  
  // First, add all reference points as manual entries
  for (const ref of sortedRefs) {
    result.push({
      id: crypto.randomUUID(),
      pointId: ref.pointId,
      pointNumber: ref.pointNumber,
      kmValue: ref.kmValue,
      localDistance: ref.localDistance,
      side: 'left' as const,
      timestamp: new Date().toISOString()
    })
  }

  // Now calculate KM for points that are between references
  // We need to determine which points are on the route
  
  // Build a simple line from first to last reference point
  const lineStart = { e: firstRef.easting, n: firstRef.northing }
  const lineEnd = { e: lastRef.easting, n: lastRef.northing }
  
  // For each point not in references, check if it's close to the line
  const refPointIds = new Set(sortedRefs.map(r => r.pointId))
  
  for (const point of allPoints) {
    if (refPointIds.has(point.id)) continue
    
    // Project point onto line
    const projection = projectPointOnLine(
      point.easting, 
      point.northing,
      lineStart.e, 
      lineStart.n,
      lineEnd.e, 
      lineEnd.n
    )
    
    // Check if point is within tolerance (e.g., 10m from track)
    const distanceToLine = calculateDistance(
      point.easting, 
      point.northing,
      projection.e, 
      projection.n
    )
    
    const TOLERANCE = 10 // meters
    
    if (distanceToLine <= TOLERANCE && projection.t >= 0 && projection.t <= 1) {
      // Point is on the route, calculate its local distance
      const localDistance = firstRef.localDistance + 
        projection.t * (lastRef.localDistance - firstRef.localDistance)
      
      // Interpolate KM value
      const kmValue = firstRef.kmValue + (localDistance - firstRef.localDistance) * kmPerMeter
      
      result.push({
        id: crypto.randomUUID(),
        pointId: point.id,
        pointNumber: point.pointNumber,
        kmValue: Math.round(kmValue * 1000) / 1000, // Round to mm
        localDistance,
        side: 'left' as const,
        timestamp: new Date().toISOString()
      })
    }
  }

  // Sort result by local distance
  return result.sort((a, b) => (a.localDistance || 0) - (b.localDistance || 0))
}

/**
 * Project a point onto a line segment
 * Returns the projected point and parameter t (0 = start, 1 = end)
 */
function projectPointOnLine(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): { e: number, n: number, t: number } {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  
  if (len2 === 0) {
    return { e: x1, n: y1, t: 0 }
  }
  
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
  
  return {
    e: x1 + t * dx,
    n: y1 + t * dy,
    t
  }
}

/**
 * Extrapolate KM values for points beyond the reference points
 */
export function extrapolateKmValues(
  points: TrackedPoint[],
  _allFixedPoints: FixedPoint[],
  startKm: number,
  endKm: number
): TrackedPoint[] {
  if (points.length < 2) return points

  const result = [...points]

  // Calculate km per meter from existing points
  const sortedPoints = [...points].sort((a, b) => (a.localDistance || 0) - (b.localDistance || 0))
  const first = sortedPoints[0]
  const last = sortedPoints[sortedPoints.length - 1]

  if (!first.localDistance || !last.localDistance) return result

  const distanceDelta = last.localDistance - first.localDistance
  const kmDelta = last.kmValue - first.kmValue
  const kmPerMeter = kmDelta / distanceDelta

  // Extrapolate to start
  if (startKm !== first.kmValue) {
    const _startDistance = first.localDistance - (first.kmValue - startKm) / kmPerMeter
    // Add virtual start point or adjust first point
  }

  // Extrapolate to end
  if (endKm && endKm !== last.kmValue) {
    const _endDistance = last.localDistance + (endKm - last.kmValue) / kmPerMeter
    // Add virtual end point or adjust last point
  }

  return result
}

/**
 * Format KM value for display
 * Input: meters (e.g., 1423.50)
 * Output: "KM 1,4 + 23,5"
 *
 * Format explanation:
 * - 1423.50m = KM 1,4 + 23,5
 * - 480.00m = KM 0,4 + 80,0
 */
export function formatKmValue(meters: number): string {
  const km = Math.floor(meters / 1000)
  const hektometer = Math.floor((meters % 1000) / 100)
  const rest = meters % 100

  return `KM ${km},${hektometer} + ${rest.toFixed(1)}`
}

/**
 * Parse KM string to meters
 * Supports multiple formats:
 * - "KM 1,4 + 23,5" -> 1423.5
 * - "1423.5" -> 1423.5
 * - "1,4+23,5" -> 1423.5
 */
export function parseKmValue(kmString: string): number | null {
  // Remove whitespace
  const cleaned = kmString.trim()

  // Handle "KM 1,4 + 23,5" format
  const kmMatch = cleaned.match(/KM\s*(\d+),(\d+)\s*\+\s*(\d+(?:[,.]\d+)?)/)
  if (kmMatch) {
    const km = parseInt(kmMatch[1])
    const hektometer = parseInt(kmMatch[2])
    const rest = parseFloat(kmMatch[3].replace(',', '.'))
    return km * 1000 + hektometer * 100 + rest
  }

  // Handle "1,4+23,5" format
  const shortMatch = cleaned.match(/(\d+),(\d+)\s*\+\s*(\d+(?:[,.]\d+)?)/)
  if (shortMatch) {
    const km = parseInt(shortMatch[1])
    const hektometer = parseInt(shortMatch[2])
    const rest = parseFloat(shortMatch[3].replace(',', '.'))
    return km * 1000 + hektometer * 100 + rest
  }

  // Handle plain number with comma
  const commaMatch = cleaned.match(/^(\d+),(\d+)$/)
  if (commaMatch) {
    return parseFloat(cleaned.replace(',', '.'))
  }

  // Handle plain decimal number
  const decimalMatch = cleaned.match(/^(\d+(?:\.\d+)?)$/)
  if (decimalMatch) {
    return parseFloat(cleaned)
  }

  return null
}
