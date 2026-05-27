import { FixedPoint, TrackedPoint, GpsPoint } from '../db/models'

// Earth's radius in meters (WGS84 mean radius)
const EARTH_RADIUS = 6371008.8

interface ReferencePoint {
  pointId: string
  pointNumber: string
  kmValue: number
  localDistance: number // Distance from run start in meters
  longitude: number
  latitude: number
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180)
}

/**
 * Calculate the distance between two points using the Haversine formula (WGS84)
 * Returns distance in meters
 */
export function calculateDistance(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const φ1 = toRadians(lat1)
  const φ2 = toRadians(lat2)
  const Δφ = toRadians(lat2 - lat1)
  const Δλ = toRadians(lon2 - lon1)

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return EARTH_RADIUS * c
}

/**
 * Calculate bearing (azimuth) from point 1 to point 2
 * Returns bearing in radians (0 = North, π/2 = East)
 */
export function calculateBearing(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const φ1 = toRadians(lat1)
  const φ2 = toRadians(lat2)
  const Δλ = toRadians(lon2 - lon1)

  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)

  return Math.atan2(y, x)
}

/**
 * Project a position along a bearing for a given distance
 * Returns [longitude, latitude]
 */
export function projectPosition(
  lon: number,
  lat: number,
  bearing: number,
  distance: number
): [number, number] {
  const φ1 = toRadians(lat)
  const λ1 = toRadians(lon)
  const δ = distance / EARTH_RADIUS

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) +
    Math.cos(φ1) * Math.sin(δ) * Math.cos(bearing)
  )

  const λ2 = λ1 + Math.atan2(
    Math.sin(bearing) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  )

  return [λ2 * (180 / Math.PI), φ2 * (180 / Math.PI)]
}

/**
 * Calculate cumulative distance along a GPS track using Haversine formula
 * Returns total distance in meters
 */
export function calculateGpsTrackDistance(track: GpsPoint[]): number {
  if (track.length < 2) return 0
  let total = 0
  for (let i = 1; i < track.length; i++) {
    total += calculateDistance(
      track[i - 1].longitude,
      track[i - 1].latitude,
      track[i].longitude,
      track[i].latitude
    )
  }
  return total
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
  const lineStart = { lon: firstRef.longitude, lat: firstRef.latitude }
  const lineEnd = { lon: lastRef.longitude, lat: lastRef.latitude }

  // For each point not in references, check if it's close to the line
  const refPointIds = new Set(sortedRefs.map(r => r.pointId))

  for (const point of allPoints) {
    if (refPointIds.has(point.id)) continue

    // Project point onto line (using local planar approximation)
    const projection = projectPointOnLineWGS84(
      point.longitude,
      point.latitude,
      lineStart.lon,
      lineStart.lat,
      lineEnd.lon,
      lineEnd.lat
    )

    // Check if point is within tolerance (e.g., 10m from track)
    const distanceToLine = calculateDistance(
      point.longitude,
      point.latitude,
      projection.lon,
      projection.lat
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
 * Project a point onto a line segment using WGS84 coordinates
 * Uses local planar approximation (valid for short distances)
 * Returns the projected point and parameter t (0 = start, 1 = end)
 */
function projectPointOnLineWGS84(
  pLon: number, pLat: number,
  lon1: number, lat1: number,
  lon2: number, lat2: number
): { lon: number, lat: number, t: number } {
  // Convert to local planar coordinates (meters)
  // Scale longitude by cos(latitude) to account for convergence at poles
  const avgLat = (lat1 + lat2 + pLat) / 3
  const cosLat = Math.cos(toRadians(avgLat))
  const metersPerDegLon = 111320 * cosLat
  const metersPerDegLat = 110540

  // Convert to local meters
  const px = (pLon - lon1) * metersPerDegLon
  const py = (pLat - lat1) * metersPerDegLat
  const x2 = (lon2 - lon1) * metersPerDegLon
  const y2 = (lat2 - lat1) * metersPerDegLat

  const len2 = x2 * x2 + y2 * y2

  if (len2 === 0) {
    return { lon: lon1, lat: lat1, t: 0 }
  }

  const t = Math.max(0, Math.min(1, (px * x2 + py * y2) / len2))

  // Convert back to WGS84
  const projLon = lon1 + (t * x2) / metersPerDegLon
  const projLat = lat1 + (t * y2) / metersPerDegLat

  return {
    lon: projLon,
    lat: projLat,
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
 * Round a number to specified decimal places, always rounding .5 up
 * (avoids JavaScript's "Banker's Rounding" and floating-point issues)
 */
function roundHalfUp(value: number, decimals: number): string {
  // Add a small offset to ensure .5 always rounds up (handles floating-point precision)
  const offset = 0.5 * Math.pow(10, -(decimals + 1))
  const multiplier = Math.pow(10, decimals)
  const rounded = Math.floor((value + offset) * multiplier + 0.5) / multiplier
  return rounded.toFixed(decimals)
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

  return `KM ${km},${hektometer} + ${roundHalfUp(rest, 1)}`
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
