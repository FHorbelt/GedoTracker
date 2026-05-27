import { GpsPoint } from '../db/models'
import { BaseSpline, snapToSpline } from './pointSuggestion'

/**
 * Trim a GPS track to only the monotonically progressing portion along a spline.
 * Removes backwards-movement at the start and end (e.g., walking back before/after the run).
 *
 * Algorithm:
 * 1. Snap each GPS point to the spline to get distanceAlongSpline
 * 2. Find the point with minimum distanceAlongSpline (actual start)
 * 3. Find the point with maximum distanceAlongSpline (actual end)
 * 4. Keep only points between those indices
 *
 * Returns the trimmed track and start/end distances.
 */
export function trimGpsTrackMonotone(
  gpsTrack: GpsPoint[],
  spline: BaseSpline
): { trimmedTrack: GpsPoint[], startDistance: number, endDistance: number } {
  if (gpsTrack.length === 0) {
    return { trimmedTrack: [], startDistance: 0, endDistance: 0 }
  }

  // Snap all points to spline
  const snapped = gpsTrack.map(point => {
    const snap = snapToSpline(spline, { latitude: point.latitude, longitude: point.longitude })
    return { point, distanceAlongSpline: snap.distanceAlongSpline, distanceFromSpline: snap.distanceFromClick }
  })

  // Filter out points too far from spline (>100m)
  const onSpline = snapped.filter(s => s.distanceFromSpline < 100)
  if (onSpline.length === 0) {
    return { trimmedTrack: gpsTrack, startDistance: 0, endDistance: 0 }
  }

  // Find min and max distance along spline
  let minIdx = 0
  let maxIdx = 0
  let minDist = onSpline[0].distanceAlongSpline
  let maxDist = onSpline[0].distanceAlongSpline

  for (let i = 1; i < onSpline.length; i++) {
    if (onSpline[i].distanceAlongSpline < minDist) {
      minDist = onSpline[i].distanceAlongSpline
      minIdx = i
    }
    if (onSpline[i].distanceAlongSpline > maxDist) {
      maxDist = onSpline[i].distanceAlongSpline
      maxIdx = i
    }
  }

  // Ensure startIdx < endIdx
  const startIdx = Math.min(minIdx, maxIdx)
  const endIdx = Math.max(minIdx, maxIdx)

  // Map back to original track indices
  const originalStartIdx = gpsTrack.indexOf(onSpline[startIdx].point)
  const originalEndIdx = gpsTrack.indexOf(onSpline[endIdx].point)

  const trimmedTrack = gpsTrack.slice(
    Math.max(0, originalStartIdx),
    Math.min(gpsTrack.length, originalEndIdx + 1)
  )

  // Safety: never return empty track when input has data
  if (trimmedTrack.length === 0) {
    return { trimmedTrack: gpsTrack, startDistance: 0, endDistance: 0 }
  }

  return {
    trimmedTrack,
    startDistance: minDist,
    endDistance: maxDist
  }
}
