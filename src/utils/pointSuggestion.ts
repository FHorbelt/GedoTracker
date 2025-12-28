import { FixedPoint, TrackedPoint } from '../db/models'
import { calculateDistance } from './kmCalculation'

export interface PointSuggestion {
  point: FixedPoint
  distance: number
  direction: 'forward' | 'backward'
  suggestedSide?: 'left' | 'right'  // Auto-detected side for point pairs
  isPair?: boolean  // Indicates if this point is part of a pair
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
      firstFixed.easting,
      firstFixed.northing,
      currentFixed.easting,
      currentFixed.northing
    )

    if (distance > PAIR_DISTANCE_THRESHOLD) {
      secondFixed = currentFixed
      _secondTracked = trackedPoints[i]
      break
    }
  }

  // If we found two separated points, use GPS coordinates
  if (firstFixed && secondFixed) {
    const northingDiff = secondFixed.northing - firstFixed.northing
    const eastingDiff = secondFixed.easting - firstFixed.easting

    if (Math.abs(northingDiff) > Math.abs(eastingDiff)) {
      return northingDiff > 0 ? 'forward' : 'backward'
    } else {
      return eastingDiff > 0 ? 'forward' : 'backward'
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
): { easting: number, northing: number } {

  // Check if this point has a paired point at the same station
  const pairedPoint = allFixedPoints.find(p => {
    if (p.id === point.id) return false
    const distance = calculateDistance(
      point.easting,
      point.northing,
      p.easting,
      p.northing
    )
    return distance <= PAIR_THRESHOLD
  })

  if (pairedPoint) {
    // Calculate midpoint between pair (actual track centerline)
    return {
      easting: (point.easting + pairedPoint.easting) / 2,
      northing: (point.northing + pairedPoint.northing) / 2
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
        const dist = calculateDistance(p1.easting, p1.northing, candidate.easting, candidate.northing)
        if (dist > PAIR_THRESHOLD) {
          p2 = candidate
        }
      }
    }

    if (p1 && p2) {
      // Calculate track direction vector
      const trackE = p2.easting - p1.easting
      const trackN = p2.northing - p1.northing
      const trackLength = Math.sqrt(trackE * trackE + trackN * trackN)

      if (trackLength > 0) {
        // Perpendicular vector (rotate 90°)
        const perpE = -trackN / trackLength
        const perpN = trackE / trackLength

        // Project 5m toward track centerline
        // Determine which side the point is on and project toward center
        return {
          easting: point.easting + perpE * 5,
          northing: point.northing + perpN * 5
        }
      }
    }
  }

  // Fallback: use point position as-is
  return {
    easting: point.easting,
    northing: point.northing
  }
}

/**
 * Calculate current vehicle position and find nearby points
 * Uses vector projection based on track centerline
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
  let prevCenterline: { easting: number, northing: number; distance: number } | undefined

  for (let i = trackedPoints.length - 2; i >= 0; i--) {
    const candidate = allFixedPoints.find(p => p.id === trackedPoints[i].pointId)
    if (!candidate) continue

    const candidateCenterline = calculateTrackCenterline(candidate, allFixedPoints, trackedPoints)

    const dist = calculateDistance(
      lastCenterline.easting,
      lastCenterline.northing,
      candidateCenterline.easting,
      candidateCenterline.northing
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

  // Calculate direction vector from previous to last centerline position
  const vectorE = lastCenterline.easting - prevCenterline.easting
  const vectorN = lastCenterline.northing - prevCenterline.northing
  const vectorLength = Math.sqrt(vectorE * vectorE + vectorN * vectorN)

  if (vectorLength < 1) return []

  // Normalize vector
  const normalizedE = vectorE / vectorLength
  const normalizedN = vectorN / vectorLength

  // Project current position along track centerline
  const currentE = lastCenterline.easting + normalizedE * distanceTraveled
  const currentN = lastCenterline.northing + normalizedN * distanceTraveled

  // Determine direction for display
  const direction = determineDirection(trackedPoints, allFixedPoints)

  // Group all fixed points into stations (pairs)
  const processedPoints = new Set<string>()
  const stations: { points: FixedPoint[]; centerE: number; centerN: number }[] = []

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
      const dist = calculateDistance(point.easting, point.northing, p.easting, p.northing)
      return dist <= PAIR_THRESHOLD && dist > 0.5
    })

    const stationPoints = [point]
    processedPoints.add(point.id)

    if (pairedPoint) {
      stationPoints.push(pairedPoint)
      processedPoints.add(pairedPoint.id)
    }

    // Calculate station centerline
    const centerE = pairedPoint
      ? (point.easting + pairedPoint.easting) / 2
      : point.easting
    const centerN = pairedPoint
      ? (point.northing + pairedPoint.northing) / 2
      : point.northing

    stations.push({ points: stationPoints, centerE, centerN })
  }

  // For each station, calculate distance along track from current position
  for (const station of stations) {
    // Vector from prevCenterline to station center
    const toStationE = station.centerE - prevCenterline.easting
    const toStationN = station.centerN - prevCenterline.northing

    // Distance along track (dot product with track direction)
    const stationDistanceAlongTrack = toStationE * normalizedE + toStationN * normalizedN

    // Current position's distance along track
    const currentDistanceAlongTrack = (currentE - prevCenterline.easting) * normalizedE +
                                       (currentN - prevCenterline.northing) * normalizedN

    // Distance from current position to station along track
    const distanceToStation = stationDistanceAlongTrack - currentDistanceAlongTrack

    // Perpendicular distance (to filter stations not on this track)
    const perpendicularDistance = Math.abs(toStationE * normalizedN - toStationN * normalizedE)

    // Only show stations:
    // 1. Within tolerance distance along track (ahead of us)
    // 2. Within 25m perpendicular distance (on this track)
    // 3. Ahead of current position (distanceToStation > -5 to allow for small errors)
    if (Math.abs(distanceToStation) <= tolerance &&
        perpendicularDistance <= 25 &&
        distanceToStation > -5) {

      // Add each point from the station
      for (const point of station.points) {
        const _directDistance = calculateDistance(currentE, currentN, point.easting, point.northing)

        suggestions.push({
          point,
          distance: Math.abs(distanceToStation),
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
  const northingDiff = point.northing - reference.northing
  const eastingDiff = point.easting - reference.easting

  if (Math.abs(northingDiff) > Math.abs(eastingDiff)) {
    return northingDiff > 0 ? 'forward' : 'backward'
  } else {
    return eastingDiff > 0 ? 'forward' : 'backward'
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
      referencePoint.easting,
      referencePoint.northing,
      point.easting,
      point.northing
    )

    // Check if point is within tolerance of expected distance
    if (Math.abs(distance - expectedDistance) <= tolerance) {
      // Determine if forward or backward based on position
      const northingDiff = point.northing - referencePoint.northing
      const direction = northingDiff > 0 ? 'forward' : 'backward'

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
      referencePoint.easting,
      referencePoint.northing,
      point.easting,
      point.northing
    )

    // Check if point is within tolerance of expected distance
    if (Math.abs(distance - expectedDistance) <= tolerance) {
      // Check if point is in the correct direction
      const northingDiff = point.northing - referencePoint.northing
      const pointDirection = northingDiff > 0 ? 'forward' : 'backward'

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
      point.easting,
      point.northing,
      p.easting,
      p.northing
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
  const travelVectorE = lastFixed.easting - secondLastFixed.easting
  const travelVectorN = lastFixed.northing - secondLastFixed.northing

  // Calculate vector from point to its pair
  const pairVectorE = pairedPoint.easting - point.easting
  const pairVectorN = pairedPoint.northing - point.northing

  // Cross product: determines which side the PAIR is on relative to travel direction
  // For Gauss-Krüger: easting is like x, northing is like y
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
      point.easting,
      point.northing,
      p.easting,
      p.northing
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
