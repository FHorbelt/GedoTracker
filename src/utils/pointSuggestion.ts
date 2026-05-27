import { FixedPoint, TrackedPoint, Direction, DraggedTrajectoryPoint, TrajectoryPoint } from '../db/models'
import { calculateDistance, calculateBearing, projectPosition } from './kmCalculation'

export interface PointSuggestion {
  point: FixedPoint
  distance: number
  direction: 'forward' | 'backward'
  suggestedSide?: 'left' | 'right'  // Auto-detected side for point pairs
  isPair?: boolean  // Indicates if this point is part of a pair
  distanceFromCurrent?: number  // Distance from current estimated position
  lateralDistance?: number  // Perpendicular distance from trajectory in meters
  distanceAlongTrajectory?: number  // Absolute position on trajectory (for display)
}

export interface StartPosition {
  latitude: number
  longitude: number
}

export interface TrackInfo {
  bearing: number  // Track bearing in radians (from spline tangent)
  startPosition: StartPosition
  estimatedPosition: StartPosition
  upcomingPoints: PointSuggestion[]
  splineCoordinates?: [number, number][]  // For map visualization [lat, lon][]
}

/**
 * Suggest fixed points based on driven distance
 * Returns points within TOLERANCE meters of the expected position
 */
export function suggestPoints(
  allFixedPoints: FixedPoint[],
  trackedPoints: TrackedPoint[],
  currentDistance: number,
  tolerance: number = 15
): PointSuggestion[] {
  if (trackedPoints.length === 0) {
    // No reference points yet - can't suggest
    return []
  }

  // Get the last tracked point
  const lastTracked = trackedPoints[trackedPoints.length - 1]
  const lastFixedPoint = allFixedPoints.find(p => p.id === lastTracked.pointId)

  if (!lastFixedPoint) {
    return []
  }

  const distanceTraveled = currentDistance - lastTracked.localDistance

  // If only one point exists, search in both directions around that point
  if (trackedPoints.length === 1) {
    return findPointsInBothDirections(
      allFixedPoints,
      lastFixedPoint,
      distanceTraveled,
      tolerance,
      trackedPoints
    )
  }

  // If two or more points exist, calculate current vehicle position using vector projection
  return findPointsFromProjectedPosition(
    allFixedPoints,
    trackedPoints,
    currentDistance,
    tolerance
  )
}

// Pair threshold: points within this distance are considered a pair at the same station
// Typical track width is ~10m, so pairs should be within ~15m
const PAIR_THRESHOLD = 15

// Perpendicular tolerance constants
// These control how far from the track centerline a point can be to still be suggested
const DEFAULT_PERPENDICULAR_TOLERANCE = 15  // Default when no data available
const MIN_PERPENDICULAR_TOLERANCE = 8       // Never go below this
const MAX_PERPENDICULAR_TOLERANCE = 20      // Never exceed this (allows for track curves)
const TOLERANCE_BUFFER = 5                  // Add buffer to calculated average

/**
 * Calculate dynamic perpendicular tolerance based on tracked points
 * Measures the actual distance of tracked points from the calculated centerline
 * and derives an appropriate tolerance from that
 */
function calculateDynamicPerpendicularTolerance(
  trackedPoints: TrackedPoint[],
  fixedPoints: FixedPoint[],
  trackBearing: number
): number {
  if (trackedPoints.length < 2) {
    return DEFAULT_PERPENDICULAR_TOLERANCE
  }

  const distances: number[] = []

  // Calculate centerline from tracked points
  const centerlines: { longitude: number; latitude: number }[] = []

  for (const tp of trackedPoints) {
    const fp = fixedPoints.find(p => p.id === tp.pointId)
    if (!fp) continue

    // Find if this point has a pair
    const pairedPoint = fixedPoints.find(p => {
      if (p.id === fp.id) return false
      const dist = calculateDistance(fp.longitude, fp.latitude, p.longitude, p.latitude)
      return dist > 0.5 && dist <= PAIR_THRESHOLD
    })

    if (pairedPoint) {
      // Use midpoint as centerline
      centerlines.push({
        longitude: (fp.longitude + pairedPoint.longitude) / 2,
        latitude: (fp.latitude + pairedPoint.latitude) / 2
      })
      // Calculate half the pair distance as typical point-to-track distance
      const pairDist = calculateDistance(fp.longitude, fp.latitude, pairedPoint.longitude, pairedPoint.latitude)
      distances.push(pairDist / 2)
    } else {
      // Single point - estimate centerline perpendicular to track
      // Project 5m perpendicular based on side
      const perpDirection = tp.side === 'left'
        ? trackBearing - Math.PI / 2
        : trackBearing + Math.PI / 2

      const [centerLon, centerLat] = projectPosition(
        fp.longitude,
        fp.latitude,
        perpDirection,
        5 // Estimated offset
      )
      centerlines.push({ longitude: centerLon, latitude: centerLat })

      // For single points, we estimate ~5m as typical distance
      // But we can refine this by checking consistency across points
      distances.push(5)
    }
  }

  // If we have pairs, use the measured distances
  // Otherwise use a conservative default
  if (distances.length === 0) {
    return DEFAULT_PERPENDICULAR_TOLERANCE
  }

  // Calculate average distance and add buffer
  const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length
  const calculatedTolerance = avgDistance + TOLERANCE_BUFFER

  // Clamp to min/max bounds
  return Math.max(
    MIN_PERPENDICULAR_TOLERANCE,
    Math.min(MAX_PERPENDICULAR_TOLERANCE, calculatedTolerance)
  )
}

/**
 * Determine the direction of travel based on tracked points
 * Uses GPS coordinates when points are separated, or point number sequence as fallback
 */
function determineDirection(
  trackedPoints: TrackedPoint[],
  allFixedPoints: FixedPoint[]
): 'forward' | 'backward' | null {
  if (trackedPoints.length < 2) return null

  const PAIR_DISTANCE_THRESHOLD = PAIR_THRESHOLD

  // Find the first two tracked points that are NOT a pair (more than 2m apart)
  let firstFixed: FixedPoint | undefined
  let _firstTracked: TrackedPoint | undefined
  let secondFixed: FixedPoint | undefined
  let _secondTracked: TrackedPoint | undefined

  for (let i = 0; i < trackedPoints.length; i++) {
    const currentFixed = allFixedPoints.find(p => p.id === trackedPoints[i].pointId)
    if (!currentFixed) continue

    if (!firstFixed) {
      firstFixed = currentFixed
      _firstTracked = trackedPoints[i]
      continue
    }

    // Check if current point is far enough from first point (not a pair)
    const distance = calculateDistance(
      firstFixed.longitude,
      firstFixed.latitude,
      currentFixed.longitude,
      currentFixed.latitude
    )

    if (distance > PAIR_DISTANCE_THRESHOLD) {
      secondFixed = currentFixed
      _secondTracked = trackedPoints[i]
      break
    }
  }

  // If we found two separated points, use GPS coordinates
  if (firstFixed && secondFixed) {
    const latitudeDiff = secondFixed.latitude - firstFixed.latitude
    const longitudeDiff = secondFixed.longitude - firstFixed.longitude

    if (Math.abs(latitudeDiff) > Math.abs(longitudeDiff)) {
      return latitudeDiff > 0 ? 'forward' : 'backward'
    } else {
      return longitudeDiff > 0 ? 'forward' : 'backward'
    }
  }

  // Fallback: Try to determine direction from point number sequence
  // If we have at least 2 points, check if numbers are increasing or decreasing
  if (trackedPoints.length >= 2) {
    const pointNumbers = trackedPoints
      .map(tp => {
        // Extract numeric part from point number (e.g., "115_L" -> 115)
        const match = tp.pointNumber.match(/(\d+)/)
        return match ? parseInt(match[1]) : null
      })
      .filter(n => n !== null) as number[]

    if (pointNumbers.length >= 2) {
      const first = pointNumbers[0]
      const last = pointNumbers[pointNumbers.length - 1]

      if (last > first) {
        return 'forward' // Point numbers increasing
      } else if (last < first) {
        return 'backward' // Point numbers decreasing
      }
    }
  }

  return null
}

/**
 * Calculate track centerline position from a fixed point
 * If it's part of a pair, use midpoint; otherwise assume 5m offset
 */
function calculateTrackCenterline(
  point: FixedPoint,
  allFixedPoints: FixedPoint[],
  trackedPoints: TrackedPoint[]
): { longitude: number, latitude: number } {

  // Check if this point has a paired point at the same station
  const pairedPoint = allFixedPoints.find(p => {
    if (p.id === point.id) return false
    const distance = calculateDistance(
      point.longitude,
      point.latitude,
      p.longitude,
      p.latitude
    )
    return distance <= PAIR_THRESHOLD
  })

  if (pairedPoint) {
    // Calculate midpoint between pair (actual track centerline)
    return {
      longitude: (point.longitude + pairedPoint.longitude) / 2,
      latitude: (point.latitude + pairedPoint.latitude) / 2
    }
  }

  // Single point: assume 5m offset perpendicular to track
  // Try to calculate perpendicular direction from trajectory
  if (trackedPoints.length >= 2) {
    // Find two separated tracked points to establish track direction
    let p1: FixedPoint | undefined
    let p2: FixedPoint | undefined

    for (let i = 0; i < trackedPoints.length && !p2; i++) {
      const candidate = allFixedPoints.find(p => p.id === trackedPoints[i].pointId)
      if (!candidate) continue

      if (!p1) {
        p1 = candidate
      } else {
        const dist = calculateDistance(p1.longitude, p1.latitude, candidate.longitude, candidate.latitude)
        if (dist > PAIR_THRESHOLD) {
          p2 = candidate
        }
      }
    }

    if (p1 && p2) {
      // Calculate track bearing and project 5m perpendicular
      const trackBearing = calculateBearing(p1.longitude, p1.latitude, p2.longitude, p2.latitude)
      // Perpendicular bearing (90° offset)
      const perpBearing = trackBearing + Math.PI / 2
      // Project 5m perpendicular to track
      const [projLon, projLat] = projectPosition(point.longitude, point.latitude, perpBearing, 5)
      return { longitude: projLon, latitude: projLat }
    }
  }

  // Fallback: use point position as-is
  return {
    longitude: point.longitude,
    latitude: point.latitude
  }
}

/**
 * Calculate current vehicle position and find nearby points
 * Uses bearing-based projection for WGS84 coordinates
 */
function findPointsFromProjectedPosition(
  allFixedPoints: FixedPoint[],
  trackedPoints: TrackedPoint[],
  currentDistance: number,
  tolerance: number
): PointSuggestion[] {
  const suggestions: PointSuggestion[] = []
  const trackedIds = new Set(trackedPoints.map(p => p.pointId))
  const trackedNumbers = new Set(trackedPoints.map(p => p.pointNumber))

  // Get last tracked point
  const lastTracked = trackedPoints[trackedPoints.length - 1]
  const lastFixed = allFixedPoints.find(p => p.id === lastTracked.pointId)

  if (!lastFixed) return []

  const distanceTraveled = currentDistance - lastTracked.localDistance

  // Calculate track centerline position for last point
  const lastCenterline = calculateTrackCenterline(lastFixed, allFixedPoints, trackedPoints)

  // Find previous tracked point that's not a pair to establish direction
  let prevCenterline: { longitude: number, latitude: number; distance: number } | undefined

  for (let i = trackedPoints.length - 2; i >= 0; i--) {
    const candidate = allFixedPoints.find(p => p.id === trackedPoints[i].pointId)
    if (!candidate) continue

    const candidateCenterline = calculateTrackCenterline(candidate, allFixedPoints, trackedPoints)

    const dist = calculateDistance(
      lastCenterline.longitude,
      lastCenterline.latitude,
      candidateCenterline.longitude,
      candidateCenterline.latitude
    )

    if (dist > PAIR_THRESHOLD) {
      prevCenterline = { ...candidateCenterline, distance: trackedPoints[i].localDistance }
      break
    }
  }

  if (!prevCenterline) {
    // Can't determine direction without two separate centerline points
    return []
  }

  // Calculate bearing from prev to last centerline position
  const trackBearing = calculateBearing(
    prevCenterline.longitude,
    prevCenterline.latitude,
    lastCenterline.longitude,
    lastCenterline.latitude
  )

  // Calculate dynamic perpendicular tolerance based on tracked points
  const perpendicularTolerance = calculateDynamicPerpendicularTolerance(
    trackedPoints,
    allFixedPoints,
    trackBearing
  )

  // Project current position along track using bearing
  const [currentLon, currentLat] = projectPosition(
    lastCenterline.longitude,
    lastCenterline.latitude,
    trackBearing,
    distanceTraveled
  )

  // Determine direction for display
  const direction = determineDirection(trackedPoints, allFixedPoints)

  // Group all fixed points into stations (pairs)
  const processedPoints = new Set<string>()
  const stations: { points: FixedPoint[]; centerLon: number; centerLat: number }[] = []

  for (const point of allFixedPoints) {
    if (processedPoints.has(point.id)) continue
    if (trackedIds.has(point.id) || trackedNumbers.has(point.pointNumber)) {
      processedPoints.add(point.id)
      continue
    }

    // Find paired point
    const pairedPoint = allFixedPoints.find(p => {
      if (p.id === point.id || processedPoints.has(p.id)) return false
      if (trackedIds.has(p.id) || trackedNumbers.has(p.pointNumber)) return false
      const dist = calculateDistance(point.longitude, point.latitude, p.longitude, p.latitude)
      return dist <= PAIR_THRESHOLD && dist > 0.5
    })

    const stationPoints = [point]
    processedPoints.add(point.id)

    if (pairedPoint) {
      stationPoints.push(pairedPoint)
      processedPoints.add(pairedPoint.id)
    }

    // Calculate station centerline
    const centerLon = pairedPoint
      ? (point.longitude + pairedPoint.longitude) / 2
      : point.longitude
    const centerLat = pairedPoint
      ? (point.latitude + pairedPoint.latitude) / 2
      : point.latitude

    stations.push({ points: stationPoints, centerLon, centerLat })
  }

  // For each station, calculate distance from current projected position
  for (const station of stations) {
    // Direct distance from current position to station
    const distanceToStation = calculateDistance(
      currentLon,
      currentLat,
      station.centerLon,
      station.centerLat
    )

    // Calculate bearing from current position to station
    const stationBearing = calculateBearing(
      currentLon,
      currentLat,
      station.centerLon,
      station.centerLat
    )

    // Check if station is roughly ahead (bearing difference < 90°) or behind
    let bearingDiff = stationBearing - trackBearing
    // Normalize to -π to π
    while (bearingDiff > Math.PI) bearingDiff -= 2 * Math.PI
    while (bearingDiff < -Math.PI) bearingDiff += 2 * Math.PI

    const isAhead = Math.abs(bearingDiff) < Math.PI / 2
    const perpendicularDistance = Math.abs(Math.sin(bearingDiff) * distanceToStation)

    // Only show stations:
    // 1. Within tolerance distance (ahead or behind)
    // 2. Within dynamic perpendicular tolerance (on this track)
    // alongTrackDistance: positive = ahead, negative = behind
    const alongTrackDistance = isAhead ? distanceToStation : -distanceToStation

    // Show points within tolerance in both directions (so they don't disappear when you reach them)
    if (Math.abs(alongTrackDistance) <= tolerance &&
        perpendicularDistance <= perpendicularTolerance) {

      // Add each point from the station
      for (const point of station.points) {
        suggestions.push({
          point,
          distance: Math.abs(alongTrackDistance),
          direction: direction || 'forward'
        })
      }
    }
  }

  // Sort by distance (closest first)
  const sorted = suggestions.sort((a, b) => a.distance - b.distance)

  // Limit to 4 suggestions (2 pairs max)
  const limited = sorted.slice(0, 4)

  // Enhance with side detection
  return enhanceSuggestionsWithSideDetection(
    limited,
    allFixedPoints,
    direction,
    trackedPoints
  )
}

/**
 * Determine direction of a single point relative to a reference point
 */
function _determinePointDirection(
  point: FixedPoint,
  reference: FixedPoint
): 'forward' | 'backward' {
  const latitudeDiff = point.latitude - reference.latitude
  const longitudeDiff = point.longitude - reference.longitude

  if (Math.abs(latitudeDiff) > Math.abs(longitudeDiff)) {
    return latitudeDiff > 0 ? 'forward' : 'backward'
  } else {
    return longitudeDiff > 0 ? 'forward' : 'backward'
  }
}

/**
 * Find points in both directions (used when only 1 point tracked)
 */
function findPointsInBothDirections(
  allFixedPoints: FixedPoint[],
  referencePoint: FixedPoint,
  expectedDistance: number,
  tolerance: number,
  trackedPoints: TrackedPoint[]
): PointSuggestion[] {
  const suggestions: PointSuggestion[] = []
  const trackedIds = new Set(trackedPoints.map(p => p.pointId))
  const trackedNumbers = new Set(trackedPoints.map(p => p.pointNumber))

  for (const point of allFixedPoints) {
    // Skip already tracked points (check both ID and number for safety)
    if (trackedIds.has(point.id) || trackedNumbers.has(point.pointNumber)) continue

    const distance = calculateDistance(
      referencePoint.longitude,
      referencePoint.latitude,
      point.longitude,
      point.latitude
    )

    // Check if point is within tolerance of expected distance
    if (Math.abs(distance - expectedDistance) <= tolerance) {
      // Determine if forward or backward based on position
      const latitudeDiff = point.latitude - referencePoint.latitude
      const direction = latitudeDiff > 0 ? 'forward' : 'backward'

      suggestions.push({
        point,
        distance,
        direction
      })
    }
  }

  const sorted = suggestions.sort((a, b) => a.distance - b.distance)

  // Enhance with side detection (will only work if we have 2+ tracked points)
  return enhanceSuggestionsWithSideDetection(
    sorted,
    allFixedPoints,
    null, // No specific direction yet
    trackedPoints
  )
}

/**
 * Find points in a specific direction
 */
function _findPointsInDirection(
  allFixedPoints: FixedPoint[],
  referencePoint: FixedPoint,
  expectedDistance: number,
  tolerance: number,
  direction: 'forward' | 'backward',
  trackedPoints: TrackedPoint[]
): PointSuggestion[] {
  const suggestions: PointSuggestion[] = []
  const trackedIds = new Set(trackedPoints.map(p => p.pointId))
  const trackedNumbers = new Set(trackedPoints.map(p => p.pointNumber))

  for (const point of allFixedPoints) {
    // Skip already tracked points (check both ID and number for safety)
    if (trackedIds.has(point.id) || trackedNumbers.has(point.pointNumber)) continue

    const distance = calculateDistance(
      referencePoint.longitude,
      referencePoint.latitude,
      point.longitude,
      point.latitude
    )

    // Check if point is within tolerance of expected distance
    if (Math.abs(distance - expectedDistance) <= tolerance) {
      // Check if point is in the correct direction
      const latitudeDiff = point.latitude - referencePoint.latitude
      const pointDirection = latitudeDiff > 0 ? 'forward' : 'backward'

      if (pointDirection === direction) {
        suggestions.push({
          point,
          distance,
          direction
        })
      }
    }
  }

  const sorted = suggestions.sort((a, b) => a.distance - b.distance)

  // Enhance with side detection
  return enhanceSuggestionsWithSideDetection(
    sorted,
    allFixedPoints,
    direction,
    trackedPoints
  )
}

/**
 * Find a paired point (another point at approximately the same location)
 * Points are considered paired if they're within PAIR_THRESHOLD meters of each other
 */
function findPairedPoint(
  point: FixedPoint,
  allPoints: FixedPoint[]
): FixedPoint | undefined {
  return allPoints.find(p => {
    if (p.id === point.id) return false

    const distance = calculateDistance(
      point.longitude,
      point.latitude,
      p.longitude,
      p.latitude
    )

    return distance <= PAIR_THRESHOLD
  })
}

/**
 * Determine which side (left/right) a point is on relative to the direction of travel
 * Uses cross product to determine if point is left or right of the travel vector
 */
function determineSideFromPair(
  point: FixedPoint,
  pairedPoint: FixedPoint,
  travelDirection: 'forward' | 'backward',
  trackedPoints: TrackedPoint[],
  allFixedPoints: FixedPoint[]
): 'left' | 'right' | undefined {
  if (trackedPoints.length < 2) return undefined

  // Get the last two tracked points to determine travel vector
  const lastTracked = trackedPoints[trackedPoints.length - 1]
  const secondLastTracked = trackedPoints[trackedPoints.length - 2]

  const lastFixed = allFixedPoints.find(p => p.id === lastTracked.pointId)
  const secondLastFixed = allFixedPoints.find(p => p.id === secondLastTracked.pointId)

  if (!lastFixed || !secondLastFixed) return undefined

  // Calculate travel vector (from second-last to last point)
  const travelVectorE = lastFixed.longitude - secondLastFixed.longitude
  const travelVectorN = lastFixed.latitude - secondLastFixed.latitude

  // Calculate vector from point to its pair
  const pairVectorE = pairedPoint.longitude - point.longitude
  const pairVectorN = pairedPoint.latitude - point.latitude

  // Cross product: determines which side the PAIR is on relative to travel direction
  // For Gauss-Krüger: longitude is like x, latitude is like y
  // Positive = pair is to the left of travel direction
  // Negative = pair is to the right of travel direction
  const crossProduct = travelVectorE * pairVectorN - travelVectorN * pairVectorE

  // If pair is to the left, then THIS point is to the RIGHT (and vice versa)
  // Also account for travel direction
  const pairIsToLeft = travelDirection === 'forward' ? crossProduct > 0 : crossProduct < 0

  // Invert: if pair is left, this point is right
  return pairIsToLeft ? 'right' : 'left'
}

/**
 * Enhance suggestions with automatic side detection for point pairs
 */
function enhanceSuggestionsWithSideDetection(
  suggestions: PointSuggestion[],
  allFixedPoints: FixedPoint[],
  direction: 'forward' | 'backward' | null,
  trackedPoints: TrackedPoint[]
): PointSuggestion[] {
  if (!direction || trackedPoints.length < 2) {
    // Can't determine side without direction and at least 2 tracked points
    return suggestions
  }

  return suggestions.map(suggestion => {
    const pairedPoint = findPairedPoint(suggestion.point, allFixedPoints)

    if (!pairedPoint) {
      // No pair found, return as-is
      return suggestion
    }

    // Point has a pair - determine which side this point is on
    const suggestedSide = determineSideFromPair(
      suggestion.point,
      pairedPoint,
      direction,
      trackedPoints,
      allFixedPoints
    )

    return {
      ...suggestion,
      isPair: true,
      suggestedSide
    }
  })
}

/**
 * Check if a point has a paired point at the same station (by point number)
 * Returns the paired point if found and not already tracked
 */
export function findPairedPointByNumber(
  pointNumber: string,
  allFixedPoints: FixedPoint[],
  trackedPoints: TrackedPoint[]
): FixedPoint | null {

  // Find the point by number
  const point = allFixedPoints.find(p => p.pointNumber === pointNumber)
  if (!point) return null

  // Check if already tracked
  const trackedNumbers = new Set(trackedPoints.map(p => p.pointNumber))

  // Find paired point (within 2m, not already tracked)
  const pairedPoint = allFixedPoints.find(p => {
    if (p.id === point.id) return false
    if (trackedNumbers.has(p.pointNumber)) return false

    const distance = calculateDistance(
      point.longitude,
      point.latitude,
      p.longitude,
      p.latitude
    )
    return distance <= PAIR_THRESHOLD
  })

  return pairedPoint || null
}

/**
 * Format suggestion for display
 */
export function formatSuggestion(suggestion: PointSuggestion): string {
  const directionIcon = suggestion.direction === 'forward' ? '→' : '←'
  const sideIndicator = suggestion.suggestedSide
    ? ` (${suggestion.suggestedSide === 'left' ? 'L' : 'R'})`
    : ''
  return `${suggestion.point.pointNumber}${sideIndicator} ${directionIcon} (~${suggestion.distance.toFixed(1)}m)`
}

/**
 * Estimate track bearing from fixed points
 * Analyzes the distribution of points to determine the main track direction
 */
export function estimateTrackBearing(fixedPoints: FixedPoint[]): number {
  if (fixedPoints.length < 2) return 0

  // Sort points by their point number (numeric part) to get track order
  const sortedPoints = [...fixedPoints].sort((a, b) => {
    const numA = parseInt(a.pointNumber.match(/\d+/)?.[0] || '0')
    const numB = parseInt(b.pointNumber.match(/\d+/)?.[0] || '0')
    return numA - numB
  })

  // Calculate average bearing between consecutive points
  let bearingSum = 0
  let count = 0

  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const p1 = sortedPoints[i]
    const p2 = sortedPoints[i + 1]

    const dist = calculateDistance(p1.longitude, p1.latitude, p2.longitude, p2.latitude)

    // Only consider points that are more than 10m apart (not pairs)
    if (dist > 10) {
      const bearing = calculateBearing(p1.longitude, p1.latitude, p2.longitude, p2.latitude)
      bearingSum += bearing
      count++
    }
  }

  return count > 0 ? bearingSum / count : 0
}

/**
 * Find the nearest fixed point to a position
 */
export function findNearestFixedPoint(
  position: StartPosition,
  fixedPoints: FixedPoint[]
): FixedPoint | null {
  if (fixedPoints.length === 0) return null

  let nearest: FixedPoint | null = null
  let minDistance = Infinity

  for (const point of fixedPoints) {
    const dist = calculateDistance(
      position.longitude,
      position.latitude,
      point.longitude,
      point.latitude
    )
    if (dist < minDistance) {
      minDistance = dist
      nearest = point
    }
  }

  return nearest
}

/**
 * Build a track path from fixed points, sorted by distance from start position along bearing
 * Returns points sorted in driving direction with cumulative distances
 */
export interface TrackPathPoint {
  point: FixedPoint
  cumulativeDistance: number  // Distance from track start in meters
  centerLon: number  // Centerline longitude (midpoint if pair exists)
  centerLat: number  // Centerline latitude
}

/**
 * Spline point with position and cumulative distance
 */
export interface SplinePoint {
  lon: number
  lat: number
  dist: number  // Cumulative distance along spline
}

/**
 * Track spline data for smooth interpolation
 */
export interface TrackSpline {
  points: SplinePoint[]  // Sampled points along the spline for visualization
  controlPoints: { lon: number, lat: number }[]  // Original control points (stations)
  totalLength: number
}

/**
 * Catmull-Rom spline interpolation
 * Returns position at parameter t (0-1) between p1 and p2
 * p0 and p3 are neighboring control points for smoothness
 */
function catmullRomInterpolate(
  p0: { lon: number, lat: number },
  p1: { lon: number, lat: number },
  p2: { lon: number, lat: number },
  p3: { lon: number, lat: number },
  t: number
): { lon: number, lat: number } {
  const t2 = t * t
  const t3 = t2 * t

  // Catmull-Rom basis functions
  const b0 = -0.5 * t3 + t2 - 0.5 * t
  const b1 = 1.5 * t3 - 2.5 * t2 + 1
  const b2 = -1.5 * t3 + 2 * t2 + 0.5 * t
  const b3 = 0.5 * t3 - 0.5 * t2

  return {
    lon: b0 * p0.lon + b1 * p1.lon + b2 * p2.lon + b3 * p3.lon,
    lat: b0 * p0.lat + b1 * p1.lat + b2 * p2.lat + b3 * p3.lat
  }
}

/**
 * Catmull-Rom spline tangent (derivative)
 * Returns the tangent direction at parameter t
 */
function catmullRomTangent(
  p0: { lon: number, lat: number },
  p1: { lon: number, lat: number },
  p2: { lon: number, lat: number },
  p3: { lon: number, lat: number },
  t: number
): { lon: number, lat: number } {
  const t2 = t * t

  // Derivatives of Catmull-Rom basis functions
  const b0 = -1.5 * t2 + 2 * t - 0.5
  const b1 = 4.5 * t2 - 5 * t
  const b2 = -4.5 * t2 + 4 * t + 0.5
  const b3 = 1.5 * t2 - t

  return {
    lon: b0 * p0.lon + b1 * p1.lon + b2 * p2.lon + b3 * p3.lon,
    lat: b0 * p0.lat + b1 * p1.lat + b2 * p2.lat + b3 * p3.lat
  }
}

/**
 * Find the two points that are furthest apart in the point set
 * These define the approximate start and end of the track
 */
function findTrackEndpoints(
  points: { lon: number, lat: number }[]
): { start: { lon: number, lat: number }, end: { lon: number, lat: number }, maxDist: number } | null {
  if (points.length < 2) return null

  let maxDist = 0
  let start = points[0]
  let end = points[1]

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dist = calculateDistance(points[i].lon, points[i].lat, points[j].lon, points[j].lat)
      if (dist > maxDist) {
        maxDist = dist
        start = points[i]
        end = points[j]
      }
    }
  }

  return { start, end, maxDist }
}

/**
 * Project a point onto a line segment and return the parameter t (0-1)
 */
function projectPointOntoLine(
  point: { lon: number, lat: number },
  lineStart: { lon: number, lat: number },
  lineEnd: { lon: number, lat: number }
): number {
  // Convert to approximate planar coordinates for projection
  const avgLat = (lineStart.lat + lineEnd.lat) / 2
  const cosLat = Math.cos(avgLat * Math.PI / 180)

  // Scale longitude by cos(lat) to get approximately equal units
  const dx = (lineEnd.lon - lineStart.lon) * cosLat
  const dy = lineEnd.lat - lineStart.lat
  const px = (point.lon - lineStart.lon) * cosLat
  const py = point.lat - lineStart.lat

  const lineLengthSq = dx * dx + dy * dy
  if (lineLengthSq === 0) return 0

  const t = (px * dx + py * dy) / lineLengthSq
  return Math.max(0, Math.min(1, t))
}

/**
 * Build a smooth spline through the centerline of fixed points
 * Uses averaging to create a smooth path through the point cloud
 */
export function buildTrackSpline(
  fixedPoints: FixedPoint[],
  startPosition: StartPosition,
  initialBearing: number
): TrackSpline | null {
  if (fixedPoints.length < 2) return null

  // Convert fixed points to simple coordinate array
  const allPoints = fixedPoints.map(p => ({ lon: p.longitude, lat: p.latitude }))

  // Find the two furthest apart points (track endpoints)
  const endpoints = findTrackEndpoints(allPoints)
  if (!endpoints) return null

  // Determine which endpoint is closer to start position (in direction of travel)
  const distToStart1 = calculateDistance(
    startPosition.longitude, startPosition.latitude,
    endpoints.start.lon, endpoints.start.lat
  )
  const distToStart2 = calculateDistance(
    startPosition.longitude, startPosition.latitude,
    endpoints.end.lon, endpoints.end.lat
  )

  // Also check bearing alignment
  const bearing1 = calculateBearing(
    startPosition.longitude, startPosition.latitude,
    endpoints.start.lon, endpoints.start.lat
  )
  const bearing2 = calculateBearing(
    startPosition.longitude, startPosition.latitude,
    endpoints.end.lon, endpoints.end.lat
  )

  const bearingDiff1 = Math.abs(bearing1 - initialBearing)
  const bearingDiff2 = Math.abs(bearing2 - initialBearing)
  const normDiff1 = bearingDiff1 > Math.PI ? 2 * Math.PI - bearingDiff1 : bearingDiff1
  const normDiff2 = bearingDiff2 > Math.PI ? 2 * Math.PI - bearingDiff2 : bearingDiff2

  // Choose endpoint that is more aligned with travel direction
  let trackStart: { lon: number, lat: number }
  let trackEnd: { lon: number, lat: number }

  if (normDiff1 < normDiff2) {
    trackStart = endpoints.start
    trackEnd = endpoints.end
  } else {
    trackStart = endpoints.end
    trackEnd = endpoints.start
  }

  // Divide the track into segments and calculate averaged control points
  const NUM_SEGMENTS = Math.max(5, Math.min(20, Math.floor(endpoints.maxDist / 50))) // ~50m per segment
  const controlPoints: { lon: number, lat: number }[] = []

  // Add start position as first control point
  controlPoints.push({ lon: startPosition.longitude, lat: startPosition.latitude })

  // For each segment, collect nearby points and average them
  for (let i = 0; i <= NUM_SEGMENTS; i++) {
    const t = i / NUM_SEGMENTS
    const segmentStart = Math.max(0, t - 0.5 / NUM_SEGMENTS)
    const segmentEnd = Math.min(1, t + 0.5 / NUM_SEGMENTS)

    // Find all points that project into this segment
    const pointsInSegment: { lon: number, lat: number }[] = []

    for (const point of allPoints) {
      const projT = projectPointOntoLine(point, trackStart, trackEnd)
      if (projT >= segmentStart && projT <= segmentEnd) {
        pointsInSegment.push(point)
      }
    }

    if (pointsInSegment.length > 0) {
      // Calculate centroid of points in this segment
      const avgLon = pointsInSegment.reduce((sum, p) => sum + p.lon, 0) / pointsInSegment.length
      const avgLat = pointsInSegment.reduce((sum, p) => sum + p.lat, 0) / pointsInSegment.length

      // Only add if significantly different from last control point
      const lastCP = controlPoints[controlPoints.length - 1]
      const distFromLast = calculateDistance(lastCP.lon, lastCP.lat, avgLon, avgLat)

      if (distFromLast > 5) { // At least 5m apart
        controlPoints.push({ lon: avgLon, lat: avgLat })
      }
    }
  }

  // Ensure we have at least 2 control points
  if (controlPoints.length < 2) {
    // Add track end as fallback
    controlPoints.push(trackEnd)
  }

  // Sample the spline at regular intervals
  const SAMPLES_PER_SEGMENT = 10
  const splinePoints: SplinePoint[] = []
  let totalLength = 0

  // Add first point
  splinePoints.push({ lon: controlPoints[0].lon, lat: controlPoints[0].lat, dist: 0 })

  // For each segment between control points
  for (let i = 0; i < controlPoints.length - 1; i++) {
    // Get 4 control points for Catmull-Rom (with clamping at ends)
    const p0 = controlPoints[Math.max(0, i - 1)]
    const p1 = controlPoints[i]
    const p2 = controlPoints[i + 1]
    const p3 = controlPoints[Math.min(controlPoints.length - 1, i + 2)]

    // Sample this segment
    for (let j = 1; j <= SAMPLES_PER_SEGMENT; j++) {
      const t = j / SAMPLES_PER_SEGMENT
      const pos = catmullRomInterpolate(p0, p1, p2, p3, t)

      // Calculate distance from previous point
      const lastPoint = splinePoints[splinePoints.length - 1]
      const segmentDist = calculateDistance(lastPoint.lon, lastPoint.lat, pos.lon, pos.lat)
      totalLength += segmentDist

      splinePoints.push({ lon: pos.lon, lat: pos.lat, dist: totalLength })
    }
  }

  return {
    points: splinePoints,
    controlPoints,
    totalLength
  }
}

/**
 * Interpolate position along the spline at a given distance
 */
export function interpolateOnSpline(
  spline: TrackSpline,
  targetDistance: number,
  startPosition: StartPosition,
  initialBearing: number
): { position: StartPosition, bearing: number } {
  // At or before start
  if (targetDistance <= 0 || spline.points.length === 0) {
    return { position: startPosition, bearing: initialBearing }
  }

  const points = spline.points

  // Beyond end of spline - extrapolate
  if (targetDistance >= spline.totalLength) {
    const lastIdx = points.length - 1
    if (lastIdx < 1) {
      return { position: { latitude: points[0].lat, longitude: points[0].lon }, bearing: initialBearing }
    }

    // Calculate bearing from last segment
    const p1 = points[lastIdx - 1]
    const p2 = points[lastIdx]
    const bearing = calculateBearing(p1.lon, p1.lat, p2.lon, p2.lat)

    // Extrapolate beyond end
    const extraDist = targetDistance - spline.totalLength
    const [lon, lat] = projectPosition(p2.lon, p2.lat, bearing, extraDist)

    return { position: { latitude: lat, longitude: lon }, bearing }
  }

  // Find the segment containing targetDistance
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]

    if (targetDistance >= p1.dist && targetDistance <= p2.dist) {
      const segmentLength = p2.dist - p1.dist
      if (segmentLength === 0) {
        const bearing = i > 0
          ? calculateBearing(points[i - 1].lon, points[i - 1].lat, p1.lon, p1.lat)
          : initialBearing
        return { position: { latitude: p1.lat, longitude: p1.lon }, bearing }
      }

      const t = (targetDistance - p1.dist) / segmentLength

      // Linear interpolation between sampled points
      const lon = p1.lon + t * (p2.lon - p1.lon)
      const lat = p1.lat + t * (p2.lat - p1.lat)

      // Calculate bearing from this segment
      const bearing = calculateBearing(p1.lon, p1.lat, p2.lon, p2.lat)

      return { position: { latitude: lat, longitude: lon }, bearing }
    }
  }

  // Fallback
  const lastPoint = points[points.length - 1]
  return {
    position: { latitude: lastPoint.lat, longitude: lastPoint.lon },
    bearing: initialBearing
  }
}

/**
 * Get spline points as coordinate array for map visualization
 */
export function getSplineCoordinates(spline: TrackSpline): [number, number][] {
  return spline.points.map(p => [p.lat, p.lon] as [number, number])
}

export function buildTrackPath(
  fixedPoints: FixedPoint[],
  startPosition: StartPosition,
  initialBearing: number,
  _maxPerpendicularDistance: number = 25
): TrackPathPoint[] {
  if (fixedPoints.length === 0) return []

  // Group points into stations (pairs within 15m of each other)
  const stations: { points: FixedPoint[], centerLon: number, centerLat: number, id: string }[] = []
  const processedIds = new Set<string>()

  for (const point of fixedPoints) {
    if (processedIds.has(point.id)) continue

    // Find paired point
    const pairedPoint = fixedPoints.find(p => {
      if (p.id === point.id || processedIds.has(p.id)) return false
      const dist = calculateDistance(point.longitude, point.latitude, p.longitude, p.latitude)
      return dist > 0.5 && dist <= 15
    })

    const stationPoints = [point]
    processedIds.add(point.id)

    let centerLon = point.longitude
    let centerLat = point.latitude

    if (pairedPoint) {
      stationPoints.push(pairedPoint)
      processedIds.add(pairedPoint.id)
      centerLon = (point.longitude + pairedPoint.longitude) / 2
      centerLat = (point.latitude + pairedPoint.latitude) / 2
    }

    stations.push({ points: stationPoints, centerLon, centerLat, id: point.id })
  }

  if (stations.length === 0) return []

  // Use "nearest neighbor" traversal to follow the actual track curve
  // Start from the station closest to the start position in the direction of travel

  // Find stations ahead of start (using initial bearing to filter direction)
  const stationsAhead: typeof stations = []
  for (const station of stations) {
    const bearing = calculateBearing(
      startPosition.longitude,
      startPosition.latitude,
      station.centerLon,
      station.centerLat
    )
    const bearingDiff = Math.abs(bearing - initialBearing)
    // Normalize to 0-PI
    const normalizedDiff = bearingDiff > Math.PI ? 2 * Math.PI - bearingDiff : bearingDiff

    // Station is roughly ahead if bearing difference < 90°
    if (normalizedDiff < Math.PI / 2) {
      stationsAhead.push(station)
    }
  }

  // If no stations ahead, use all stations
  const candidateStations = stationsAhead.length > 0 ? stationsAhead : stations

  // Find the nearest station to start position (among candidates)
  let nearestStation = candidateStations[0]
  let nearestDist = calculateDistance(
    startPosition.longitude,
    startPosition.latitude,
    nearestStation.centerLon,
    nearestStation.centerLat
  )

  for (const station of candidateStations) {
    const dist = calculateDistance(
      startPosition.longitude,
      startPosition.latitude,
      station.centerLon,
      station.centerLat
    )
    if (dist < nearestDist) {
      nearestDist = dist
      nearestStation = station
    }
  }

  // Build path using nearest-neighbor traversal starting from nearestStation
  const orderedStations: typeof stations = []
  const visitedIds = new Set<string>()
  let currentStation = nearestStation

  // First, traverse forward from nearest station
  while (currentStation) {
    orderedStations.push(currentStation)
    visitedIds.add(currentStation.id)

    // Find nearest unvisited station
    let nextStation: typeof stations[0] | null = null
    let nextDist = Infinity

    for (const station of stations) {
      if (visitedIds.has(station.id)) continue

      const dist = calculateDistance(
        currentStation.centerLon,
        currentStation.centerLat,
        station.centerLon,
        station.centerLat
      )

      // Only consider stations within reasonable distance (max 200m between stations)
      if (dist < nextDist && dist < 200) {
        // Check that we're generally continuing in the same direction (not going backwards)
        if (orderedStations.length >= 2) {
          const prevStation = orderedStations[orderedStations.length - 2]
          const prevBearing = calculateBearing(
            prevStation.centerLon,
            prevStation.centerLat,
            currentStation.centerLon,
            currentStation.centerLat
          )
          const nextBearing = calculateBearing(
            currentStation.centerLon,
            currentStation.centerLat,
            station.centerLon,
            station.centerLat
          )
          const bearingChange = Math.abs(nextBearing - prevBearing)
          const normalizedChange = bearingChange > Math.PI ? 2 * Math.PI - bearingChange : bearingChange

          // Allow up to 90° turn (for curves)
          if (normalizedChange > Math.PI / 2) continue
        }

        nextDist = dist
        nextStation = station
      }
    }

    currentStation = nextStation!
  }

  // Build path with cumulative distances from start position
  const pathPoints: TrackPathPoint[] = []
  let cumulativeDistance = 0
  let lastLon = startPosition.longitude
  let lastLat = startPosition.latitude

  for (const station of orderedStations) {
    // Calculate distance from previous point (or start position for first)
    const segmentDist = calculateDistance(
      lastLon,
      lastLat,
      station.centerLon,
      station.centerLat
    )
    cumulativeDistance += segmentDist

    // Add all points from this station
    for (const point of station.points) {
      pathPoints.push({
        point,
        cumulativeDistance,
        centerLon: station.centerLon,
        centerLat: station.centerLat
      })
    }

    lastLon = station.centerLon
    lastLat = station.centerLat
  }

  return pathPoints
}

/**
 * Interpolate position along a track path for a given distance
 * Returns the interpolated position on the curved track
 */
export function interpolatePositionOnPath(
  trackPath: TrackPathPoint[],
  targetDistance: number,
  startPosition: StartPosition,
  initialBearing: number
): StartPosition {
  // Special case: at or near start position
  if (targetDistance <= 0) {
    return startPosition
  }

  if (trackPath.length === 0) {
    // Fallback to linear projection
    const [lon, lat] = projectPosition(
      startPosition.longitude,
      startPosition.latitude,
      initialBearing,
      targetDistance
    )
    return { latitude: lat, longitude: lon }
  }

  // Find unique centerline positions (stations, not individual points)
  // Include start position as the first point (distance 0)
  const centerlines: { lon: number, lat: number, dist: number }[] = [
    { lon: startPosition.longitude, lat: startPosition.latitude, dist: 0 }
  ]
  const seen = new Set<string>()
  seen.add(`${startPosition.longitude.toFixed(6)},${startPosition.latitude.toFixed(6)}`)

  for (const pp of trackPath) {
    const key = `${pp.centerLon.toFixed(6)},${pp.centerLat.toFixed(6)}`
    if (!seen.has(key)) {
      seen.add(key)
      centerlines.push({
        lon: pp.centerLon,
        lat: pp.centerLat,
        dist: pp.cumulativeDistance
      })
    }
  }

  // Sort by cumulative distance
  centerlines.sort((a, b) => a.dist - b.dist)

  if (centerlines.length < 2) {
    const [lon, lat] = projectPosition(
      startPosition.longitude,
      startPosition.latitude,
      initialBearing,
      targetDistance
    )
    return { latitude: lat, longitude: lon }
  }

  const lastPoint = centerlines[centerlines.length - 1]

  // After last point: extrapolate forward from last segment
  if (targetDistance >= lastPoint.dist) {
    const secondLast = centerlines[centerlines.length - 2]
    const bearing = calculateBearing(secondLast.lon, secondLast.lat, lastPoint.lon, lastPoint.lat)
    const extraDist = targetDistance - lastPoint.dist
    const [lon, lat] = projectPosition(lastPoint.lon, lastPoint.lat, bearing, extraDist)
    return { latitude: lat, longitude: lon }
  }

  // Find the segment containing targetDistance
  for (let i = 0; i < centerlines.length - 1; i++) {
    const p1 = centerlines[i]
    const p2 = centerlines[i + 1]

    if (targetDistance >= p1.dist && targetDistance <= p2.dist) {
      // Interpolate between p1 and p2
      const segmentLength = p2.dist - p1.dist
      if (segmentLength === 0) {
        return { latitude: p1.lat, longitude: p1.lon }
      }

      const t = (targetDistance - p1.dist) / segmentLength

      // Linear interpolation of coordinates (good enough for short segments)
      const lon = p1.lon + t * (p2.lon - p1.lon)
      const lat = p1.lat + t * (p2.lat - p1.lat)

      return { latitude: lat, longitude: lon }
    }
  }

  // Fallback (shouldn't reach here)
  return { latitude: lastPoint.lat, longitude: lastPoint.lon }
}

/**
 * Calculate track centerline position for a tracked point
 * Uses the L/R side information and the paired point if available
 */
function calculateCenterlineFromTrackedPoint(
  trackedPoint: TrackedPoint,
  fixedPoints: FixedPoint[],
  previousBearing?: number
): { longitude: number; latitude: number; distance: number } | null {
  const fixedPoint = fixedPoints.find(p => p.id === trackedPoint.pointId)
  if (!fixedPoint) return null

  // Find paired point (within 15m)
  const pairedPoint = fixedPoints.find(p => {
    if (p.id === fixedPoint.id) return false
    const dist = calculateDistance(fixedPoint.longitude, fixedPoint.latitude, p.longitude, p.latitude)
    return dist > 0.5 && dist <= 15
  })

  if (pairedPoint) {
    // Use midpoint of pair as centerline
    return {
      longitude: (fixedPoint.longitude + pairedPoint.longitude) / 2,
      latitude: (fixedPoint.latitude + pairedPoint.latitude) / 2,
      distance: trackedPoint.localDistance
    }
  }

  // Single point - offset perpendicular to track based on side
  // If we have a previous bearing, use it to calculate perpendicular offset
  if (previousBearing !== undefined) {
    // "side" means: the point is on this side of the vehicle
    // So if point is on LEFT of vehicle, vehicle (centerline) is on RIGHT of point
    // To go from point to centerline:
    // - Point on LEFT of vehicle → go RIGHT → bearing - π/2 (perpendicular right in travel direction)
    // - Point on RIGHT of vehicle → go LEFT → bearing + π/2 (perpendicular left in travel direction)
    const offsetDirection = trackedPoint.side === 'left'
      ? previousBearing - Math.PI / 2  // Point is left, centerline is right of point
      : previousBearing + Math.PI / 2  // Point is right, centerline is left of point

    const [centerLon, centerLat] = projectPosition(
      fixedPoint.longitude,
      fixedPoint.latitude,
      offsetDirection,
      5 // Assume ~5m to track center
    )
    return { longitude: centerLon, latitude: centerLat, distance: trackedPoint.localDistance }
  }

  // Fallback: use point position as-is
  return {
    longitude: fixedPoint.longitude,
    latitude: fixedPoint.latitude,
    distance: trackedPoint.localDistance
  }
}

/**
 * Calculate local track bearing from recent tracked points
 * Uses centerline positions for accurate bearing calculation
 */
function calculateLocalBearing(
  trackedPoints: TrackedPoint[],
  fixedPoints: FixedPoint[],
  fallbackBearing: number
): number {
  if (trackedPoints.length < 2) return fallbackBearing

  // Calculate centerline positions for tracked points
  const centerlines: { longitude: number; latitude: number; distance: number }[] = []
  let currentBearing = fallbackBearing

  for (const tp of trackedPoints) {
    const centerline = calculateCenterlineFromTrackedPoint(tp, fixedPoints, currentBearing)
    if (centerline) {
      // Check if this centerline is far enough from the last one (not a pair)
      if (centerlines.length === 0) {
        centerlines.push(centerline)
      } else {
        const last = centerlines[centerlines.length - 1]
        const dist = calculateDistance(last.longitude, last.latitude, centerline.longitude, centerline.latitude)
        if (dist > 10) { // More than 10m apart = different station
          centerlines.push(centerline)
          // Update bearing for next iteration
          currentBearing = calculateBearing(last.longitude, last.latitude, centerline.longitude, centerline.latitude)
        }
      }
    }
  }

  // Need at least 2 distinct centerline positions
  if (centerlines.length < 2) return fallbackBearing

  // Calculate weighted average bearing from recent segments
  // Give more weight to recent segments for curve handling
  let totalWeight = 0
  let weightedBearingX = 0
  let weightedBearingY = 0

  for (let i = 1; i < centerlines.length; i++) {
    const prev = centerlines[i - 1]
    const curr = centerlines[i]
    const segmentBearing = calculateBearing(prev.longitude, prev.latitude, curr.longitude, curr.latitude)

    // Weight increases for more recent segments (exponential)
    const weight = Math.pow(2, i)
    totalWeight += weight

    // Use vector addition for bearing averaging (handles wraparound correctly)
    weightedBearingX += Math.cos(segmentBearing) * weight
    weightedBearingY += Math.sin(segmentBearing) * weight
  }

  if (totalWeight === 0) return fallbackBearing

  // Calculate average bearing from weighted vector
  return Math.atan2(weightedBearingY / totalWeight, weightedBearingX / totalWeight)
}

/**
 * Calculate track info from start position and current distance
 * Returns estimated current position and upcoming points
 */
export function calculateTrackInfo(
  startPosition: StartPosition,
  currentDistance: number,
  direction: Direction,
  fixedPoints: FixedPoint[],
  trackedPoints: TrackedPoint[] = []
): TrackInfo | null {
  if (fixedPoints.length < 2) return null

  // First, get a global bearing estimate for fallback
  let globalBearing = estimateTrackBearing(fixedPoints)
  if (direction === 'descending') {
    globalBearing = globalBearing + Math.PI
  }

  // Calculate local bearing from tracked points if we have enough data
  let trackBearing: number
  if (trackedPoints.length >= 2) {
    trackBearing = calculateLocalBearing(trackedPoints, fixedPoints, globalBearing)
  } else {
    trackBearing = globalBearing
  }

  // Calculate estimated current position
  const [estLon, estLat] = projectPosition(
    startPosition.longitude,
    startPosition.latitude,
    trackBearing,
    currentDistance
  )

  const estimatedPosition: StartPosition = {
    latitude: estLat,
    longitude: estLon
  }

  // Find upcoming points (ahead of current position)
  const upcomingPoints = findUpcomingPoints(
    estimatedPosition,
    trackBearing,
    fixedPoints,
    trackedPoints,
    100 // Look ahead 100m
  )

  return {
    bearing: trackBearing,
    startPosition,
    estimatedPosition,
    upcomingPoints
  }
}

/**
 * Infer track affinity from tracked points
 * Returns a function that scores how likely a point belongs to the same track
 */
function inferTrackAffinity(
  trackedPoints: TrackedPoint[],
  fixedPoints: FixedPoint[]
): (point: FixedPoint) => number {
  if (trackedPoints.length === 0) {
    // No tracked points yet - accept all points equally
    return () => 1
  }

  // Extract numeric prefixes from tracked point numbers to detect track patterns
  // e.g., 100001, 100002 -> prefix 100000; 200001, 200002 -> prefix 200000
  const trackedPrefixes = new Map<number, number>()

  for (const tp of trackedPoints) {
    const match = tp.pointNumber.match(/^(\d+)/)
    if (match) {
      const num = parseInt(match[1])
      // Round to nearest 100000 to get track prefix
      const prefix = Math.floor(num / 100000) * 100000
      trackedPrefixes.set(prefix, (trackedPrefixes.get(prefix) || 0) + 1)
    }
  }

  // Find the dominant prefix (most common track)
  let dominantPrefix = -1
  let maxCount = 0
  for (const [prefix, count] of trackedPrefixes) {
    if (count > maxCount) {
      maxCount = count
      dominantPrefix = prefix
    }
  }

  return (point: FixedPoint): number => {
    if (dominantPrefix === -1) return 1 // No pattern detected

    const match = point.pointNumber.match(/^(\d+)/)
    if (!match) return 0.5 // Can't parse number

    const num = parseInt(match[1])
    const prefix = Math.floor(num / 100000) * 100000

    // Same track = high score, different track = low score
    return prefix === dominantPrefix ? 1 : 0.1
  }
}

/**
 * Find points that are ahead of the current position along the track
 */
export function findUpcomingPoints(
  currentPosition: StartPosition,
  trackBearing: number,  // Track bearing in radians for left/right determination
  fixedPoints: FixedPoint[],
  trackedPoints: TrackedPoint[],
  lookAheadDistance: number,
  trajectorySpline?: BaseSpline | null,
  currentDistanceOnSpline?: number
): PointSuggestion[] {
  const suggestions: PointSuggestion[] = []
  const trackedIds = new Set(trackedPoints.map(p => p.pointId))
  const trackedNumbers = new Set(trackedPoints.map(p => p.pointNumber))

  // Trajectory-based mode: use snapToSpline for distance and side calculation
  if (trajectorySpline && currentDistanceOnSpline !== undefined) {
    for (const point of fixedPoints) {
      if (trackedIds.has(point.id) || trackedNumbers.has(point.pointNumber)) continue
      if (point.latitude == null || point.longitude == null) continue

      const snap = snapToSpline(trajectorySpline, { latitude: point.latitude, longitude: point.longitude })
      const distanceAhead = snap.distanceAlongSpline - currentDistanceOnSpline

      // Show points up to 10m behind (just passed but not yet tracked) and within lookAheadDistance ahead
      if (distanceAhead < -10 || distanceAhead > lookAheadDistance) continue

      // Left/right: cross product using bearing from snap point (tangent at projected position)
      const bearing = snap.bearing
      const trackEast = Math.sin(bearing)
      const trackNorth = Math.cos(bearing)
      const avgLat = snap.position.latitude * Math.PI / 180
      const cosLat = Math.cos(avgLat)
      const toEast = (point.longitude - snap.position.longitude) * cosLat
      const toNorth = point.latitude - snap.position.latitude
      const cross = trackEast * toNorth - trackNorth * toEast
      const suggestedSide: 'left' | 'right' = cross > 0 ? 'left' : 'right'

      suggestions.push({
        point,
        distance: distanceAhead,
        distanceFromCurrent: distanceAhead,
        direction: 'forward',
        suggestedSide,
        lateralDistance: snap.distanceFromClick,
        distanceAlongTrajectory: snap.distanceAlongSpline
      })
    }

    suggestions.sort((a, b) => a.distance - b.distance)
    return suggestions.slice(0, 10)
  }

  // Fallback: Haversine distance with corrected left/right calculation
  const avgLat = currentPosition.latitude * Math.PI / 180
  const cosLat = Math.cos(avgLat)
  const trackEast = Math.sin(trackBearing)
  const trackNorth = Math.cos(trackBearing)

  for (const point of fixedPoints) {
    if (trackedIds.has(point.id) || trackedNumbers.has(point.pointNumber)) continue
    if (point.latitude == null || point.longitude == null) continue

    const distanceToPoint = calculateDistance(
      currentPosition.longitude,
      currentPosition.latitude,
      point.longitude,
      point.latitude
    )

    if (distanceToPoint > lookAheadDistance) continue

    // Corrected left/right: use ENU (East-North-Up) with cos(lat) correction
    const toEast = (point.longitude - currentPosition.longitude) * cosLat
    const toNorth = point.latitude - currentPosition.latitude
    const cross = trackEast * toNorth - trackNorth * toEast
    const suggestedSide: 'left' | 'right' = cross > 0 ? 'left' : 'right'

    suggestions.push({
      point,
      distance: distanceToPoint,
      distanceFromCurrent: distanceToPoint,
      direction: 'forward',
      suggestedSide
    })
  }

  suggestions.sort((a, b) => a.distance - b.distance)
  return suggestions.slice(0, 10)
}

/**
 * Suggest points from a manual start position (no tracked points needed)
 */
export function suggestPointsFromStartPosition(
  startPosition: StartPosition,
  currentDistance: number,
  direction: Direction,
  fixedPoints: FixedPoint[],
  tolerance: number = 20
): PointSuggestion[] {
  const trackInfo = calculateTrackInfo(startPosition, currentDistance, direction, fixedPoints, [])

  if (!trackInfo) return []

  // Filter to points within tolerance of current distance
  return trackInfo.upcomingPoints.filter(
    p => p.distance >= -5 && p.distance <= tolerance
  )
}

// ============================================================================
// Base Spline Functions (without user start position)
// ============================================================================

/**
 * Base spline computed purely from fixed points (no user input needed)
 */
export interface BaseSpline {
  points: SplinePoint[]              // Sampled points along spline for visualization
  controlPoints: { lon: number, lat: number }[]  // Station centerlines
  totalLength: number                // Total arc length of spline
  startBearing: number               // Bearing at start of spline (radians)
  endBearing: number                 // Bearing at end of spline (radians)
}

/**
 * Result of snapping a position to the spline
 */
export interface SnapResult {
  position: { latitude: number; longitude: number }
  bearing: number                    // Tangent direction at snapped point (radians)
  distanceAlongSpline: number        // Cumulative distance from spline start
  distanceFromClick: number          // How far the click was from the spline (for validation)
}

/**
 * Station representing a pair of fixed points or a single point
 */
interface Station {
  points: FixedPoint[]
  centerLon: number
  centerLat: number
}

/**
 * Group fixed points into stations (pairs within 15m of each other)
 */
function groupIntoStations(fixedPoints: FixedPoint[]): Station[] {
  const stations: Station[] = []
  const processedIds = new Set<string>()

  for (const point of fixedPoints) {
    if (processedIds.has(point.id)) continue

    // Find paired point (within 15m)
    const pairedPoint = fixedPoints.find(p => {
      if (p.id === point.id || processedIds.has(p.id)) return false
      const dist = calculateDistance(point.longitude, point.latitude, p.longitude, p.latitude)
      return dist > 0.5 && dist <= PAIR_THRESHOLD
    })

    const stationPoints = [point]
    processedIds.add(point.id)

    let centerLon = point.longitude
    let centerLat = point.latitude

    if (pairedPoint) {
      stationPoints.push(pairedPoint)
      processedIds.add(pairedPoint.id)
      centerLon = (point.longitude + pairedPoint.longitude) / 2
      centerLat = (point.latitude + pairedPoint.latitude) / 2
    }

    stations.push({ points: stationPoints, centerLon, centerLat })
  }

  return stations
}

/**
 * Sort stations along the track axis (from start to end)
 */
function sortStationsAlongTrack(
  stations: Station[],
  trackStart: { lon: number, lat: number },
  trackEnd: { lon: number, lat: number }
): Station[] {
  return [...stations].sort((a, b) => {
    const tA = projectPointOntoLine({ lon: a.centerLon, lat: a.centerLat }, trackStart, trackEnd)
    const tB = projectPointOntoLine({ lon: b.centerLon, lat: b.centerLat }, trackStart, trackEnd)
    return tA - tB
  })
}

// Configurable station tolerance for debugging (in meters)
// This can be adjusted via setStationTolerance()
let STATION_TOLERANCE_METERS = 25

/**
 * Set the station tolerance in meters (for debugging/tuning)
 */
export function setStationTolerance(meters: number): void {
  STATION_TOLERANCE_METERS = meters
}

/**
 * Get current station tolerance in meters
 */
export function getStationTolerance(): number {
  return STATION_TOLERANCE_METERS
}

export type TrackSide = 'all' | 'left' | 'right'

// Configurable smoothing passes
let SMOOTHING_PASSES = 0

/**
 * Set the number of smoothing passes (0 = no smoothing)
 */
export function setSmoothingPasses(passes: number): void {
  SMOOTHING_PASSES = Math.max(0, Math.min(10, passes))
}

/**
 * Get current smoothing passes
 */
export function getSmoothingPasses(): number {
  return SMOOTHING_PASSES
}

/**
 * Smooth control points using weighted moving average
 * Each point becomes the weighted average of itself and its neighbors
 * Supports fractional passes (0.2 = 20% smoothing strength)
 */
function smoothControlPoints(
  points: { lon: number, lat: number }[],
  passes: number = 2
): { lon: number, lat: number }[] {
  if (points.length < 3 || passes <= 0) return [...points]

  let result = [...points]

  // Handle fractional and whole passes
  const wholePasses = Math.floor(passes)
  const fractionalPart = passes - wholePasses

  // Apply whole passes first
  for (let pass = 0; pass < wholePasses; pass++) {
    result = applySmoothingPass(result, 1.0)
  }

  // Apply fractional pass if any
  if (fractionalPart > 0) {
    result = applySmoothingPass(result, fractionalPart)
  }

  return result
}

/**
 * Apply a single smoothing pass with configurable strength
 * strength: 0 = no change, 1 = full smoothing (25% prev + 50% curr + 25% next)
 */
function applySmoothingPass(
  points: { lon: number, lat: number }[],
  strength: number
): { lon: number, lat: number }[] {
  const smoothed: { lon: number, lat: number }[] = []

  for (let i = 0; i < points.length; i++) {
    if (i === 0 || i === points.length - 1) {
      // Keep endpoints fixed
      smoothed.push({ ...points[i] })
    } else {
      // Weighted average with adjustable strength
      // At strength=1: 25% prev + 50% current + 25% next
      // At strength=0.5: 12.5% prev + 75% current + 12.5% next
      const neighborWeight = 0.25 * strength
      const currentWeight = 1 - (2 * neighborWeight)

      const prev = points[i - 1]
      const curr = points[i]
      const next = points[i + 1]

      smoothed.push({
        lon: prev.lon * neighborWeight + curr.lon * currentWeight + next.lon * neighborWeight,
        lat: prev.lat * neighborWeight + curr.lat * currentWeight + next.lat * neighborWeight
      })
    }
  }

  return smoothed
}

/**
 * Filter fixed points by their position relative to a reference spline.
 * Points are classified as 'left' or 'right' based on their perpendicular position
 * relative to the spline's direction.
 */
export function filterPointsBySide(
  points: FixedPoint[],
  referenceSpline: BaseSpline,
  side: TrackSide
): FixedPoint[] {
  if (side === 'all' || !referenceSpline || referenceSpline.points.length < 2) {
    return points
  }

  return points.filter(point => {
    // Find closest point on spline
    const snapResult = snapToSpline(referenceSpline, { latitude: point.latitude, longitude: point.longitude })

    // Find the segment index for bearing calculation
    let segmentIdx = 0
    for (let i = 0; i < referenceSpline.points.length - 1; i++) {
      if (snapResult.distanceAlongSpline >= referenceSpline.points[i].dist &&
          snapResult.distanceAlongSpline <= referenceSpline.points[i + 1].dist) {
        segmentIdx = i
        break
      }
    }

    // Get spline tangent direction at this point
    const p1 = referenceSpline.points[segmentIdx]
    const p2 = referenceSpline.points[Math.min(segmentIdx + 1, referenceSpline.points.length - 1)]

    // Vector from spline point to fixed point
    const toPointX = point.longitude - snapResult.position.longitude
    const toPointY = point.latitude - snapResult.position.latitude

    // Tangent vector (direction of spline)
    const tangentX = p2.lon - p1.lon
    const tangentY = p2.lat - p1.lat

    // Cross product: tangent × toPoint
    // Positive = point is on the left, Negative = point is on the right
    const cross = tangentX * toPointY - tangentY * toPointX

    if (side === 'left') {
      return cross > 0
    } else {
      return cross < 0
    }
  })
}

/**
 * Find stations by grouping points that are close together perpendicular to the track axis.
 * Returns station centerpoints (midpoint between all points at that station).
 */
function findStationsAlongAxis(
  points: { lon: number, lat: number }[],
  axisStart: { lon: number, lat: number },
  axisEnd: { lon: number, lat: number }
): { lon: number, lat: number, t: number }[] {
  if (points.length === 0) return []

  // Project all points onto axis and sort by t-value
  const projectedPoints = points.map(p => ({
    point: p,
    t: projectPointOntoLine(p, axisStart, axisEnd)
  })).sort((a, b) => a.t - b.t)

  // Group points into stations based on their t-value (along-track position)
  const axisLength = calculateDistance(axisStart.lon, axisStart.lat, axisEnd.lon, axisEnd.lat)
  const STATION_TOLERANCE = STATION_TOLERANCE_METERS / axisLength // tolerance in t-units

  const stations: { points: { lon: number, lat: number }[], avgT: number }[] = []
  let currentStation: { points: { lon: number, lat: number }[], avgT: number } | null = null

  for (const proj of projectedPoints) {
    if (!currentStation) {
      currentStation = { points: [proj.point], avgT: proj.t }
    } else if (Math.abs(proj.t - currentStation.avgT) <= STATION_TOLERANCE) {
      // Same station - add point
      currentStation.points.push(proj.point)
      // Update average t
      currentStation.avgT = currentStation.points.reduce((sum, _, i) =>
        sum + projectedPoints.find(p => p.point === currentStation!.points[i])!.t, 0
      ) / currentStation.points.length
    } else {
      // New station
      stations.push(currentStation)
      currentStation = { points: [proj.point], avgT: proj.t }
    }
  }

  // Don't forget the last station
  if (currentStation) {
    stations.push(currentStation)
  }

  // Calculate centerpoint for each station
  return stations.map(station => {
    const avgLon = station.points.reduce((sum, p) => sum + p.lon, 0) / station.points.length
    const avgLat = station.points.reduce((sum, p) => sum + p.lat, 0) / station.points.length
    return { lon: avgLon, lat: avgLat, t: station.avgT }
  })
}

/**
 * Build a base spline through fixed points WITHOUT any user-provided start position.
 * The spline represents a smoothed track centerline computed by:
 * 1. Finding the overall track axis (furthest apart points)
 * 2. Grouping points into stations (points at similar along-track position)
 * 3. Computing station centerpoints (average of all points at each station)
 * 4. Building a smooth spline through station centers
 *
 * If draggedPoints are provided, they are used to adjust the control points
 * at specific positions, allowing manual correction of the trajectory.
 */
export function buildBaseSpline(
  fixedPoints: FixedPoint[],
  draggedPoints?: DraggedTrajectoryPoint[]
): BaseSpline | null {
  if (fixedPoints.length < 2) return null

  // Convert all fixed points to simple coordinate array
  const allPoints = fixedPoints.map(p => ({ lon: p.longitude, lat: p.latitude }))

  // Find the two furthest apart points (track endpoints)
  const endpoints = findTrackEndpoints(allPoints)
  if (!endpoints) return null

  // Find stations along the axis and compute their centerpoints
  const stationCenters = findStationsAlongAxis(allPoints, endpoints.start, endpoints.end)

  // Convert station centers to control points
  const controlPoints: { lon: number, lat: number }[] = []

  for (const station of stationCenters) {
    // Only add if significantly different from last control point
    if (controlPoints.length === 0) {
      controlPoints.push({ lon: station.lon, lat: station.lat })
    } else {
      const lastCP = controlPoints[controlPoints.length - 1]
      const distFromLast = calculateDistance(lastCP.lon, lastCP.lat, station.lon, station.lat)
      if (distFromLast > 5) { // At least 5m apart
        controlPoints.push({ lon: station.lon, lat: station.lat })
      }
    }
  }

  // Ensure we have at least 2 control points
  if (controlPoints.length < 2) {
    if (controlPoints.length === 0) {
      controlPoints.push(endpoints.start)
    }
    controlPoints.push(endpoints.end)
  }

  // Apply dragged point adjustments if provided
  // Match by original coordinates instead of index, since indices can change
  if (draggedPoints && draggedPoints.length > 0) {
    for (const draggedPoint of draggedPoints) {
      // Only apply if the point was actually modified
      if (draggedPoint.adjustedLat === draggedPoint.originalLat &&
          draggedPoint.adjustedLon === draggedPoint.originalLon) {
        continue
      }

      // Find the control point closest to the original position
      let bestMatchIdx = -1
      let bestMatchDist = Infinity

      for (let i = 0; i < controlPoints.length; i++) {
        const dist = calculateDistance(
          controlPoints[i].lon, controlPoints[i].lat,
          draggedPoint.originalLon, draggedPoint.originalLat
        )
        if (dist < bestMatchDist) {
          bestMatchDist = dist
          bestMatchIdx = i
        }
      }

      // Only apply if we found a close match (within 10m)
      if (bestMatchIdx >= 0 && bestMatchDist < 10) {
        controlPoints[bestMatchIdx] = {
          lon: draggedPoint.adjustedLon,
          lat: draggedPoint.adjustedLat
        }
      }
    }
  }

  // Apply smoothing if configured
  if (SMOOTHING_PASSES > 0 && controlPoints.length >= 3) {
    const smoothed = smoothControlPoints(controlPoints, SMOOTHING_PASSES)
    controlPoints.length = 0
    controlPoints.push(...smoothed)
  }

  // Calculate bearings at start and end for extension
  const startBearingCalc = calculateBearing(
    controlPoints[0].lon, controlPoints[0].lat,
    controlPoints[1].lon, controlPoints[1].lat
  )
  const endBearingCalc = calculateBearing(
    controlPoints[controlPoints.length - 2].lon, controlPoints[controlPoints.length - 2].lat,
    controlPoints[controlPoints.length - 1].lon, controlPoints[controlPoints.length - 1].lat
  )

  // Extend the track by 500m at both ends (enough to cover driving beyond fixed points)
  const EXTENSION_LENGTH = 500 // meters

  // Extend at start (project backwards)
  const [extStartLon, extStartLat] = projectPosition(
    controlPoints[0].lon, controlPoints[0].lat,
    startBearingCalc + Math.PI, // Reverse direction
    EXTENSION_LENGTH
  )
  controlPoints.unshift({ lon: extStartLon, lat: extStartLat })

  // Extend at end (project forwards)
  const [extEndLon, extEndLat] = projectPosition(
    controlPoints[controlPoints.length - 1].lon, controlPoints[controlPoints.length - 1].lat,
    endBearingCalc,
    EXTENSION_LENGTH
  )
  controlPoints.push({ lon: extEndLon, lat: extEndLat })

  // Sample the spline at regular intervals using Catmull-Rom interpolation
  const SAMPLES_PER_SEGMENT = 10
  const splinePoints: SplinePoint[] = []
  let totalLength = 0

  // Add first point
  splinePoints.push({ lon: controlPoints[0].lon, lat: controlPoints[0].lat, dist: 0 })

  // For each segment between control points
  for (let i = 0; i < controlPoints.length - 1; i++) {
    // Get 4 control points for Catmull-Rom (with clamping at ends)
    const p0 = controlPoints[Math.max(0, i - 1)]
    const p1 = controlPoints[i]
    const p2 = controlPoints[i + 1]
    const p3 = controlPoints[Math.min(controlPoints.length - 1, i + 2)]

    // Sample this segment
    for (let j = 1; j <= SAMPLES_PER_SEGMENT; j++) {
      const t = j / SAMPLES_PER_SEGMENT
      const pos = catmullRomInterpolate(p0, p1, p2, p3, t)

      // Calculate distance from previous point
      const lastPoint = splinePoints[splinePoints.length - 1]
      const segmentDist = calculateDistance(lastPoint.lon, lastPoint.lat, pos.lon, pos.lat)
      totalLength += segmentDist

      splinePoints.push({ lon: pos.lon, lat: pos.lat, dist: totalLength })
    }
  }

  // Calculate start and end bearings from spline tangents
  const startBearing = splinePoints.length >= 2
    ? calculateBearing(splinePoints[0].lon, splinePoints[0].lat, splinePoints[1].lon, splinePoints[1].lat)
    : 0

  const endBearing = splinePoints.length >= 2
    ? calculateBearing(
        splinePoints[splinePoints.length - 2].lon,
        splinePoints[splinePoints.length - 2].lat,
        splinePoints[splinePoints.length - 1].lon,
        splinePoints[splinePoints.length - 1].lat
      )
    : 0

  return {
    points: splinePoints,
    controlPoints,
    totalLength,
    startBearing,
    endBearing
  }
}

/**
 * Generate draggable trajectory points from a spline's control points.
 * These points can be displayed as draggable markers for manual trajectory adjustment.
 * Excludes the extension points at start and end (first and last control point).
 */
export function generateDragPoints(spline: BaseSpline): DraggedTrajectoryPoint[] {
  if (!spline || spline.controlPoints.length < 3) {
    return []
  }

  const dragPoints: DraggedTrajectoryPoint[] = []

  // Skip first and last control points (these are the 50m extensions)
  // Start at index 1, end at length-2
  for (let i = 1; i < spline.controlPoints.length - 1; i++) {
    const cp = spline.controlPoints[i]
    dragPoints.push({
      index: i,
      originalLat: cp.lat,
      originalLon: cp.lon,
      adjustedLat: cp.lat,
      adjustedLon: cp.lon
    })
  }

  return dragPoints
}

/**
 * Merge existing dragged points with newly generated ones.
 * Preserves user adjustments where the original positions match.
 */
export function mergeDragPoints(
  newPoints: DraggedTrajectoryPoint[],
  existingPoints: DraggedTrajectoryPoint[] | undefined
): DraggedTrajectoryPoint[] {
  if (!existingPoints || existingPoints.length === 0) {
    return newPoints
  }

  return newPoints.map(newPoint => {
    // Find matching existing point by original coordinates (not by index!)
    // This is important because indices can change when spline is rebuilt
    let bestMatch: DraggedTrajectoryPoint | null = null
    let bestMatchDist = Infinity

    for (const existing of existingPoints) {
      // Only consider points that were actually modified
      if (existing.adjustedLat === existing.originalLat &&
          existing.adjustedLon === existing.originalLon) {
        continue
      }

      const origDist = calculateDistance(
        newPoint.originalLon, newPoint.originalLat,
        existing.originalLon, existing.originalLat
      )

      if (origDist < bestMatchDist) {
        bestMatchDist = origDist
        bestMatch = existing
      }
    }

    // If we found a close match (within 5m), preserve the adjustment
    if (bestMatch && bestMatchDist < 5) {
      return {
        ...newPoint,
        adjustedLat: bestMatch.adjustedLat,
        adjustedLon: bestMatch.adjustedLon
      }
    }

    // No match - use new point as-is
    return newPoint
  })
}

/**
 * Snap a position (click or GPS) to the nearest point on the spline.
 * Returns the snapped position, bearing at that point, and distance along spline.
 */
export function snapToSpline(
  spline: BaseSpline,
  clickPosition: { latitude: number; longitude: number }
): SnapResult {
  const points = spline.points

  if (points.length === 0) {
    return {
      position: clickPosition,
      bearing: spline.startBearing,
      distanceAlongSpline: 0,
      distanceFromClick: Infinity
    }
  }

  // Find the closest sampled point
  let minDist = Infinity
  let closestIdx = 0

  for (let i = 0; i < points.length; i++) {
    const dist = calculateDistance(
      clickPosition.longitude, clickPosition.latitude,
      points[i].lon, points[i].lat
    )
    if (dist < minDist) {
      minDist = dist
      closestIdx = i
    }
  }

  // Refine by checking neighboring segments for exact closest point
  let bestResult = {
    lon: points[closestIdx].lon,
    lat: points[closestIdx].lat,
    dist: points[closestIdx].dist,
    perpDist: minDist
  }

  // Check segment before closest point
  if (closestIdx > 0) {
    const refined = projectPointOntoSegmentWGS84(
      clickPosition,
      points[closestIdx - 1],
      points[closestIdx]
    )
    if (refined.perpDist < bestResult.perpDist) {
      bestResult = {
        lon: refined.lon,
        lat: refined.lat,
        dist: points[closestIdx - 1].dist + refined.t * (points[closestIdx].dist - points[closestIdx - 1].dist),
        perpDist: refined.perpDist
      }
    }
  }

  // Check segment after closest point
  if (closestIdx < points.length - 1) {
    const refined = projectPointOntoSegmentWGS84(
      clickPosition,
      points[closestIdx],
      points[closestIdx + 1]
    )
    if (refined.perpDist < bestResult.perpDist) {
      bestResult = {
        lon: refined.lon,
        lat: refined.lat,
        dist: points[closestIdx].dist + refined.t * (points[closestIdx + 1].dist - points[closestIdx].dist),
        perpDist: refined.perpDist
      }
    }
  }

  // Calculate tangent bearing at the snapped position
  // Find the segment containing the snapped distance
  let bearing = spline.startBearing
  for (let i = 0; i < points.length - 1; i++) {
    if (bestResult.dist >= points[i].dist && bestResult.dist <= points[i + 1].dist) {
      bearing = calculateBearing(points[i].lon, points[i].lat, points[i + 1].lon, points[i + 1].lat)
      break
    }
  }

  return {
    position: { latitude: bestResult.lat, longitude: bestResult.lon },
    bearing,
    distanceAlongSpline: bestResult.dist,
    distanceFromClick: bestResult.perpDist
  }
}

/**
 * Project a point onto a line segment (WGS84 coordinates)
 * Returns the projected position and perpendicular distance
 */
function projectPointOntoSegmentWGS84(
  point: { latitude: number; longitude: number },
  segStart: { lon: number; lat: number; dist: number },
  segEnd: { lon: number; lat: number; dist: number }
): { lon: number; lat: number; t: number; perpDist: number } {
  // Convert to approximate planar coordinates for projection
  const avgLat = (segStart.lat + segEnd.lat) / 2
  const cosLat = Math.cos(avgLat * Math.PI / 180)

  // Scale longitude by cos(lat) to get approximately equal units
  const dx = (segEnd.lon - segStart.lon) * cosLat
  const dy = segEnd.lat - segStart.lat
  const px = (point.longitude - segStart.lon) * cosLat
  const py = point.latitude - segStart.lat

  const lineLengthSq = dx * dx + dy * dy
  if (lineLengthSq === 0) {
    return {
      lon: segStart.lon,
      lat: segStart.lat,
      t: 0,
      perpDist: calculateDistance(point.longitude, point.latitude, segStart.lon, segStart.lat)
    }
  }

  // Project point onto line, clamped to segment
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lineLengthSq))

  // Calculate projected position
  const projLon = segStart.lon + t * (segEnd.lon - segStart.lon)
  const projLat = segStart.lat + t * (segEnd.lat - segStart.lat)

  // Calculate perpendicular distance
  const perpDist = calculateDistance(point.longitude, point.latitude, projLon, projLat)

  return { lon: projLon, lat: projLat, t, perpDist }
}

/**
 * Reverse the spline direction (swap start and end)
 * Used when user wants to travel in the opposite direction
 */
export function reverseSpline(spline: BaseSpline): BaseSpline {
  const reversedPoints = spline.points.map((p, i, arr) => ({
    lon: p.lon,
    lat: p.lat,
    dist: spline.totalLength - p.dist
  })).reverse()

  const reversedControlPoints = [...spline.controlPoints].reverse()

  return {
    points: reversedPoints,
    controlPoints: reversedControlPoints,
    totalLength: spline.totalLength,
    startBearing: spline.endBearing + Math.PI, // Flip 180°
    endBearing: spline.startBearing + Math.PI
  }
}

/**
 * Get a portion of the spline starting from a given distance
 * Useful for showing only the remaining track from the start position
 */
export function truncateSplineFromStart(
  spline: BaseSpline,
  startDistance: number
): TrackSpline {
  // Find points after startDistance
  const truncatedPoints = spline.points
    .filter(p => p.dist >= startDistance)
    .map(p => ({
      lon: p.lon,
      lat: p.lat,
      dist: p.dist - startDistance // Adjust distances to start from 0
    }))

  // If startDistance is within a segment, interpolate the starting point
  if (truncatedPoints.length > 0 && truncatedPoints[0].dist > 0) {
    // Find the segment containing startDistance
    for (let i = 0; i < spline.points.length - 1; i++) {
      const p1 = spline.points[i]
      const p2 = spline.points[i + 1]

      if (startDistance >= p1.dist && startDistance <= p2.dist) {
        const t = (startDistance - p1.dist) / (p2.dist - p1.dist)
        const interpLon = p1.lon + t * (p2.lon - p1.lon)
        const interpLat = p1.lat + t * (p2.lat - p1.lat)

        truncatedPoints.unshift({ lon: interpLon, lat: interpLat, dist: 0 })
        break
      }
    }
  }

  // Find control points after the start position
  const truncatedControlPoints = spline.controlPoints.filter(cp => {
    // Find the closest spline point to this control point
    let minDist = Infinity
    let splineDist = 0
    for (const sp of spline.points) {
      const d = calculateDistance(cp.lon, cp.lat, sp.lon, sp.lat)
      if (d < minDist) {
        minDist = d
        splineDist = sp.dist
      }
    }
    return splineDist >= startDistance
  })

  return {
    points: truncatedPoints,
    controlPoints: truncatedControlPoints.length > 0 ? truncatedControlPoints : spline.controlPoints,
    totalLength: spline.totalLength - startDistance
  }
}

/**
 * Get base spline coordinates for map visualization
 */
export function getBaseSplineCoordinates(spline: BaseSpline): [number, number][] {
  return spline.points.map(p => [p.lat, p.lon] as [number, number])
}

/**
 * Build a spline from ordered trajectory points (e.g. from a KML LineString).
 * Unlike buildBaseSpline(), the points are already ordered and represent the
 * centerline — no station grouping or pair detection needed.
 * Uses the original points directly (linear segments) without any smoothing
 * so the trajectory stays exactly as imported.
 */
export function buildSplineFromTrajectoryPoints(
  points: TrajectoryPoint[]
): BaseSpline | null {
  if (points.length < 2) return null

  const controlPoints = points.map(p => ({ lon: p.lon, lat: p.lat }))

  // Build spline points directly from the original trajectory points (no interpolation)
  const splinePoints: SplinePoint[] = []
  let totalLength = 0

  splinePoints.push({ lon: controlPoints[0].lon, lat: controlPoints[0].lat, dist: 0 })

  for (let i = 1; i < controlPoints.length; i++) {
    const prev = controlPoints[i - 1]
    const curr = controlPoints[i]
    const segmentDist = calculateDistance(prev.lon, prev.lat, curr.lon, curr.lat)
    totalLength += segmentDist
    splinePoints.push({ lon: curr.lon, lat: curr.lat, dist: totalLength })
  }

  // Calculate start and end bearings
  const startBearing = splinePoints.length >= 2
    ? calculateBearing(splinePoints[0].lon, splinePoints[0].lat, splinePoints[1].lon, splinePoints[1].lat)
    : 0

  const endBearing = splinePoints.length >= 2
    ? calculateBearing(
        splinePoints[splinePoints.length - 2].lon,
        splinePoints[splinePoints.length - 2].lat,
        splinePoints[splinePoints.length - 1].lon,
        splinePoints[splinePoints.length - 1].lat
      )
    : 0

  return {
    points: splinePoints,
    controlPoints,
    totalLength,
    startBearing,
    endBearing
  }
}
