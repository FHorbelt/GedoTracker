import { FixedPoint, TrackedPoint } from '../db/models'
import { calculateDistance, calculateBearing, projectPosition } from '../utils/kmCalculation'

interface TrackVisualizationProps {
  allFixedPoints: FixedPoint[]
  trackedPoints: TrackedPoint[]
  currentDistance: number
}

export function TrackVisualization({
  allFixedPoints,
  trackedPoints,
  currentDistance
}: TrackVisualizationProps) {
  if (trackedPoints.length < 2) {
    // Don't show until we have at least 2 points (position and direction are clear)
    return null
  }

  // Calculate current vehicle position and get nearby points
  const nearbyPoints = calculateNearbyPoints(allFixedPoints, trackedPoints, currentDistance)

  if (nearbyPoints.length === 0) return null

  return (
    <div className="w-full bg-white rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-medium text-slate-700 mb-3">Fahrtverlauf</h3>
      <svg
        viewBox="0 0 400 200"
        className="w-full h-auto"
        style={{ maxHeight: '200px' }}
      >
        {/* Track centerline */}
        <line
          x1="20"
          y1="100"
          x2="380"
          y2="100"
          stroke="#fbbf24"
          strokeWidth="4"
        />

        {/* Direction arrow */}
        {nearbyPoints.length > 0 && nearbyPoints[0].travelDirection && (
          <g>
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" fill="#f59e0b" />
              </marker>
            </defs>
            <line
              x1="340"
              y1="100"
              x2="370"
              y2="100"
              stroke="#f59e0b"
              strokeWidth="3"
              markerEnd="url(#arrowhead)"
            />
          </g>
        )}

        {/* Render stations - paired points at same X position */}
        {nearbyPoints.map((item, idx) => {
          // All points in a station share the same X coordinate
          const x = 20 + ((idx / Math.max(1, nearbyPoints.length - 1)) * 360)

          // Determine which point is actually on top vs bottom based on geometry
          const topPoint = item.topPoint
          const bottomPoint = item.bottomPoint
          const isTopTracked = topPoint && trackedPoints.some(tp => tp.pointNumber === topPoint.pointNumber)
          const isBottomTracked = bottomPoint && trackedPoints.some(tp => tp.pointNumber === bottomPoint.pointNumber)

          return (
            <g key={`station-${idx}`}>
              {/* Top point */}
              {topPoint && (
                <>
                  <circle
                    cx={x}
                    cy="70"
                    r="6"
                    fill={isTopTracked ? '#ef4444' : '#fca5a5'}
                    stroke={isTopTracked ? '#991b1b' : '#ef4444'}
                    strokeWidth="2"
                  />
                  <text
                    x={x}
                    y="60"
                    textAnchor="middle"
                    fontSize="10"
                    fill="#1e293b"
                  >
                    {topPoint.pointNumber}
                  </text>
                </>
              )}

              {/* Bottom point */}
              {bottomPoint && (
                <>
                  <circle
                    cx={x}
                    cy="130"
                    r="6"
                    fill={isBottomTracked ? '#ef4444' : '#fca5a5'}
                    stroke={isBottomTracked ? '#991b1b' : '#ef4444'}
                    strokeWidth="2"
                  />
                  <text
                    x={x}
                    y="145"
                    textAnchor="middle"
                    fontSize="10"
                    fill="#1e293b"
                  >
                    {bottomPoint.pointNumber}
                  </text>
                </>
              )}
            </g>
          )
        })}

        {/* Vehicle position - always show at calculated position */}
        {nearbyPoints.length > 0 && nearbyPoints[0].vehicleRelativePosition !== undefined && (
          <>
            <circle
              cx={20 + (nearbyPoints[0].vehicleRelativePosition * 360)}
              cy="100"
              r="10"
              fill="#22c55e"
              stroke="#15803d"
              strokeWidth="3"
            />
            <circle
              cx={20 + (nearbyPoints[0].vehicleRelativePosition * 360)}
              cy="100"
              r="4"
              fill="white"
            />
          </>
        )}
      </svg>

      {/* Legend */}
      <div className="flex gap-4 mt-3 text-xs text-slate-600">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-green-700"></div>
          <span>Messfahrzeug</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-red-500 border-2 border-red-900"></div>
          <span>Erfasst</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-red-200 border-2 border-red-500"></div>
          <span>Kommend</span>
        </div>
      </div>
    </div>
  )
}

interface NearbyPointItem {
  point: FixedPoint
  topPoint?: FixedPoint
  bottomPoint?: FixedPoint
  distance: number
  vehicleRelativePosition?: number // 0-1, position of vehicle relative to visible stations
  travelDirection?: 'forward' | 'backward'
}

/**
 * Calculate nearby points to display (2 before, current, 2 after)
 * Uses track centerline (Gleismitte) for accurate positioning
 */
function calculateNearbyPoints(
  allFixedPoints: FixedPoint[],
  trackedPoints: TrackedPoint[],
  currentDistance: number
): NearbyPointItem[] {
  if (trackedPoints.length < 2) return []

  // Pair threshold: points within this distance are considered a pair at the same station
  // Typical track width is ~10m, so pairs should be within ~15m
  const PAIR_THRESHOLD = 15

  // Maximum perpendicular distance from track to consider a station
  const MAX_PERPENDICULAR_DISTANCE = 25

  // Step 1: Find track direction from tracked points using Gleismitte (track centerline)
  const trackedCenterlines: { longitude: number; latitude: number; distance: number }[] = []

  for (const tp of trackedPoints) {
    const fixedPoint = allFixedPoints.find(p => p.id === tp.pointId)
    if (!fixedPoint) continue

    // Find paired point (within PAIR_THRESHOLD)
    const pairedPoint = allFixedPoints.find(p => {
      if (p.id === fixedPoint.id) return false
      const dist = calculateDistance(fixedPoint.longitude, fixedPoint.latitude, p.longitude, p.latitude)
      return dist <= PAIR_THRESHOLD && dist > 0.5 // At least 0.5m apart to be a valid pair
    })

    // Calculate centerline position
    let centerE: number, centerN: number
    if (pairedPoint) {
      // Use midpoint of pair
      centerE = (fixedPoint.longitude + pairedPoint.longitude) / 2
      centerN = (fixedPoint.latitude + pairedPoint.latitude) / 2
    } else {
      // Single point - use as-is (will be offset calculation later if needed)
      centerE = fixedPoint.longitude
      centerN = fixedPoint.latitude
    }

    // Avoid duplicates (paired points would create same centerline)
    const isDuplicate = trackedCenterlines.some(tc =>
      Math.abs(tc.longitude - centerE) < 0.1 && Math.abs(tc.latitude - centerN) < 0.1
    )

    if (!isDuplicate) {
      trackedCenterlines.push({ longitude: centerE, latitude: centerN, distance: tp.localDistance })
    }
  }

  if (trackedCenterlines.length < 2) return []

  // Use last two distinct centerlines for direction
  const lastCenter = trackedCenterlines[trackedCenterlines.length - 1]
  const prevCenter = trackedCenterlines[trackedCenterlines.length - 2]

  // Calculate direction vector
  const vectorE = lastCenter.longitude - prevCenter.longitude
  const vectorN = lastCenter.latitude - prevCenter.latitude
  const vectorLength = Math.sqrt(vectorE * vectorE + vectorN * vectorN)

  if (vectorLength < 1) return [] // Too close, can't determine direction

  const normalizedE = vectorE / vectorLength
  const normalizedN = vectorN / vectorLength

  // Step 2: Calculate current vehicle position along track
  const distanceTraveled = currentDistance - lastCenter.distance
  const currentE = lastCenter.longitude + normalizedE * distanceTraveled
  const currentN = lastCenter.latitude + normalizedN * distanceTraveled

  // Step 3: Group all fixed points into stations (pairs)
  const processedPoints = new Set<string>()
  const stations: { points: FixedPoint[]; centerE: number; centerN: number }[] = []

  for (const point of allFixedPoints) {
    if (processedPoints.has(point.id)) continue

    // Find paired point
    const pairedPoint = allFixedPoints.find(p => {
      if (p.id === point.id || processedPoints.has(p.id)) return false
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
    const centerE = pairedPoint
      ? (point.longitude + pairedPoint.longitude) / 2
      : point.longitude
    const centerN = pairedPoint
      ? (point.latitude + pairedPoint.latitude) / 2
      : point.latitude

    stations.push({ points: stationPoints, centerE, centerN })
  }

  // Step 4: Calculate distance along track and perpendicular distance for each station
  interface StationWithDistance {
    points: FixedPoint[]
    centerE: number
    centerN: number
    distanceAlongTrack: number
    perpendicularDistance: number
  }

  const stationsWithDistance: StationWithDistance[] = []

  for (const station of stations) {
    // Vector from track origin (prevCenter) to station center
    const toStationE = station.centerE - prevCenter.longitude
    const toStationN = station.centerN - prevCenter.latitude

    // Distance along track (dot product)
    const distanceAlongTrack = toStationE * normalizedE + toStationN * normalizedN

    // Perpendicular distance (cross product magnitude)
    const perpendicularDistance = Math.abs(toStationE * normalizedN - toStationN * normalizedE)

    // Only include stations reasonably close to track
    if (perpendicularDistance <= MAX_PERPENDICULAR_DISTANCE) {
      stationsWithDistance.push({
        ...station,
        distanceAlongTrack,
        perpendicularDistance
      })
    }
  }

  // Step 5: Calculate current position's distance along track
  const toCurrentE = currentE - prevCenter.longitude
  const toCurrentN = currentN - prevCenter.latitude
  const currentDistanceAlongTrack = toCurrentE * normalizedE + toCurrentN * normalizedN

  // Step 6: Sort stations by distance along track
  stationsWithDistance.sort((a, b) => a.distanceAlongTrack - b.distanceAlongTrack)

  // Step 7: Find stations near current position (2 before, 3 after)
  let currentIndex = stationsWithDistance.findIndex(s => s.distanceAlongTrack >= currentDistanceAlongTrack)
  if (currentIndex === -1) currentIndex = stationsWithDistance.length

  const startIndex = Math.max(0, currentIndex - 2)
  const endIndex = Math.min(stationsWithDistance.length, currentIndex + 3)

  const nearbyStations = stationsWithDistance.slice(startIndex, endIndex)

  if (nearbyStations.length === 0) return []

  // Step 8: Calculate vehicle's relative position (0-1) among visible stations
  let vehicleRelativePosition = 0.5

  if (nearbyStations.length > 1) {
    const firstStationDistance = nearbyStations[0].distanceAlongTrack
    const lastStationDistance = nearbyStations[nearbyStations.length - 1].distanceAlongTrack
    const totalSpan = lastStationDistance - firstStationDistance

    if (totalSpan > 0) {
      vehicleRelativePosition = (currentDistanceAlongTrack - firstStationDistance) / totalSpan
      vehicleRelativePosition = Math.max(0, Math.min(1, vehicleRelativePosition))
    }
  }

  // Step 9: Determine travel direction
  const travelDirection: 'forward' | 'backward' =
    trackedCenterlines[trackedCenterlines.length - 1].distance > trackedCenterlines[0].distance
      ? 'forward'
      : 'backward'

  // Step 10: Build result with top/bottom point assignment based on geometry
  const result: NearbyPointItem[] = []

  for (let i = 0; i < nearbyStations.length; i++) {
    const station = nearbyStations[i]

    let topPoint: FixedPoint | undefined
    let bottomPoint: FixedPoint | undefined

    if (station.points.length === 2) {
      const [p1, p2] = station.points

      // Use cross product to determine which side each point is on
      // Relative to track direction, positive cross = left (top), negative = right (bottom)
      const toP1E = p1.longitude - station.centerE
      const toP1N = p1.latitude - station.centerN

      // Cross product: directionE * pointN - directionN * pointE
      const cross1 = normalizedE * toP1N - normalizedN * toP1E

      if (cross1 > 0) {
        topPoint = p1
        bottomPoint = p2
      } else {
        topPoint = p2
        bottomPoint = p1
      }
    } else {
      // Single point - determine side based on cross product from track
      const point = station.points[0]
      const toPointE = point.longitude - currentE
      const toPointN = point.latitude - currentN
      const cross = normalizedE * toPointN - normalizedN * toPointE

      if (cross > 0) {
        topPoint = point
      } else {
        bottomPoint = point
      }
    }

    const representativePoint = topPoint || bottomPoint || station.points[0]
    const distanceToVehicle = Math.abs(station.distanceAlongTrack - currentDistanceAlongTrack)

    result.push({
      point: representativePoint,
      topPoint,
      bottomPoint,
      distance: distanceToVehicle,
      vehicleRelativePosition: i === 0 ? vehicleRelativePosition : undefined,
      travelDirection: i === 0 ? travelDirection : undefined
    })
  }

  return result
}
