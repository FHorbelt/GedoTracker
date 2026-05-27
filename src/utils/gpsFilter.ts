import { GpsPoint } from '../db/models'
import { calculateDistance, calculateBearing } from './kmCalculation'

// --- Configuration ---

export interface GpsFilterConfig {
  maxAccuracy: number      // Max accepted accuracy (m). Points above are rejected.
  minDisplacement: number  // Min distance from last accepted point (m). Below = stillstand.
  maxSpeed: number         // Max plausible speed (m/s). Above = GPS glitch.
  sgWindowSize: number     // Savitzky-Golay causal window size (odd, >= 3)
  sgPolyOrder: number      // Savitzky-Golay polynomial order (< windowSize)
  initDistance: number     // Net displacement to establish initial direction (m)
  bearingAlpha: number     // Exponential smoothing factor for bearing update (0..1)
}

const DEFAULT_CONFIG: GpsFilterConfig = {
  maxAccuracy: 25,
  minDisplacement: 3,
  maxSpeed: 5.0,
  sgWindowSize: 7,
  sgPolyOrder: 2,
  initDistance: 15,
  bearingAlpha: 0.15,
}

// --- Result interface ---

export interface GpsFilterResult {
  accepted: boolean
  smoothedPoint: GpsPoint | null
  totalDistance: number
  bearing: number | null    // Current travel direction in radians (null before init)
  isMoving: boolean
  initProgress: number      // 0..1 progress through init phase (1 = fully initialized)
}

// --- Matrix utilities (for SG coefficient computation) ---

function transpose(m: number[][]): number[][] {
  const rows = m.length
  const cols = m[0].length
  const result: number[][] = Array.from({ length: cols }, () => new Array(rows))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = m[i][j]
    }
  }
  return result
}

function matMul(a: number[][], b: number[][]): number[][] {
  const aRows = a.length
  const aCols = a[0].length
  const bCols = b[0].length
  const result: number[][] = Array.from({ length: aRows }, () => new Array(bCols).fill(0))
  for (let i = 0; i < aRows; i++) {
    for (let j = 0; j < bCols; j++) {
      let sum = 0
      for (let k = 0; k < aCols; k++) {
        sum += a[i][k] * b[k][j]
      }
      result[i][j] = sum
    }
  }
  return result
}

function invertMatrix(m: number[][]): number[][] {
  const n = m.length
  // Augment with identity
  const aug: number[][] = m.map((row, i) => {
    const augRow = [...row]
    for (let j = 0; j < n; j++) augRow.push(i === j ? 1 : 0)
    return augRow
  })

  // Gauss-Jordan elimination
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col
    let maxVal = Math.abs(aug[col][col])
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(aug[row][col])
      if (v > maxVal) { maxVal = v; maxRow = row }
    }
    // Swap
    if (maxRow !== col) {
      const tmp = aug[col]; aug[col] = aug[maxRow]; aug[maxRow] = tmp
    }

    const pivot = aug[col][col]
    if (Math.abs(pivot) < 1e-12) {
      throw new Error('Matrix is singular')
    }

    // Scale pivot row
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot

    // Eliminate column in other rows
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = aug[row][col]
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col][j]
      }
    }
  }

  // Extract inverse
  return aug.map(row => row.slice(n))
}

/**
 * Compute causal Savitzky-Golay coefficients.
 *
 * For a window of size `w` and polynomial degree `p`, this computes
 * coefficients such that applying them to the last `w` points gives
 * the smoothed value at the most recent point (causal = no lookahead).
 */
function computeSGCoefficients(windowSize: number, polyOrder: number): number[] {
  const w = windowSize
  const p = polyOrder

  // Vandermonde matrix J[i][k] = i^k for i=0..w-1, k=0..p
  const J: number[][] = []
  for (let i = 0; i < w; i++) {
    const row: number[] = []
    for (let k = 0; k <= p; k++) {
      row.push(Math.pow(i, k))
    }
    J.push(row)
  }

  const Jt = transpose(J)
  const JtJ = matMul(Jt, J)
  const JtJ_inv = invertMatrix(JtJ)
  const C = matMul(JtJ_inv, Jt) // (p+1) x w

  // Evaluate polynomial at t = w-1 (the current/latest point)
  const t = w - 1
  const coeffs: number[] = new Array(w).fill(0)
  for (let j = 0; j < w; j++) {
    let val = 0
    for (let k = 0; k <= p; k++) {
      val += Math.pow(t, k) * C[k][j]
    }
    coeffs[j] = val
  }

  return coeffs
}

// --- Angle utilities ---

function angleDiff(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

// --- GpsTrackFilter class ---

export class GpsTrackFilter {
  private config: GpsFilterConfig
  private sgCoeffs: number[]

  // Accepted point buffer (raw coordinates that passed the gates)
  private buffer: GpsPoint[] = []

  // Smoothed output track
  private smoothedTrack: GpsPoint[] = []

  // State
  private lastAcceptedPoint: GpsPoint | null = null
  private bearing: number | null = null
  private totalDistance: number = 0
  private isInitialized: boolean = false
  private firstAcceptedPoint: GpsPoint | null = null

  constructor(config?: Partial<GpsFilterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Ensure window size is odd and >= 3
    if (this.config.sgWindowSize < 3) this.config.sgWindowSize = 3
    if (this.config.sgWindowSize % 2 === 0) this.config.sgWindowSize++
    if (this.config.sgPolyOrder >= this.config.sgWindowSize) {
      this.config.sgPolyOrder = this.config.sgWindowSize - 1
    }

    this.sgCoeffs = computeSGCoefficients(this.config.sgWindowSize, this.config.sgPolyOrder)
  }

  /**
   * Process a single raw GPS point through the filter pipeline.
   */
  addPoint(raw: GpsPoint): GpsFilterResult {
    const initProgress = this.isInitialized ? 1 : (
      this.firstAcceptedPoint
        ? Math.min(1, calculateDistance(
            this.firstAcceptedPoint.longitude, this.firstAcceptedPoint.latitude,
            raw.longitude, raw.latitude
          ) / this.config.initDistance)
        : 0
    )

    const reject = (): GpsFilterResult => ({
      accepted: false,
      smoothedPoint: null,
      totalDistance: this.totalDistance,
      bearing: this.bearing,
      isMoving: false,
      initProgress,
    })

    // 1. Accuracy gate
    if (raw.accuracy !== undefined && raw.accuracy > this.config.maxAccuracy) {
      return reject()
    }

    // 2. Speed gate (against last accepted point)
    if (this.lastAcceptedPoint) {
      const dist = calculateDistance(
        this.lastAcceptedPoint.longitude, this.lastAcceptedPoint.latitude,
        raw.longitude, raw.latitude
      )
      const dt = (new Date(raw.timestamp).getTime() - new Date(this.lastAcceptedPoint.timestamp).getTime()) / 1000
      if (dt > 0) {
        const speed = dist / dt
        if (speed > this.config.maxSpeed) {
          return reject()
        }
      }
    }

    // 3. Displacement gate (stillstand detection)
    if (this.lastAcceptedPoint) {
      const dist = calculateDistance(
        this.lastAcceptedPoint.longitude, this.lastAcceptedPoint.latitude,
        raw.longitude, raw.latitude
      )
      if (dist < this.config.minDisplacement) {
        return reject()
      }
    }

    // --- Point accepted ---
    this.buffer.push(raw)
    this.lastAcceptedPoint = raw

    // Remember first accepted point for init phase
    if (!this.firstAcceptedPoint) {
      this.firstAcceptedPoint = raw
    }

    // 5. Init phase: wait for enough net displacement to establish direction
    if (!this.isInitialized) {
      const netDist = calculateDistance(
        this.firstAcceptedPoint.longitude, this.firstAcceptedPoint.latitude,
        raw.longitude, raw.latitude
      )
      if (netDist >= this.config.initDistance) {
        this.bearing = calculateBearing(
          this.firstAcceptedPoint.longitude, this.firstAcceptedPoint.latitude,
          raw.longitude, raw.latitude
        )
        this.isInitialized = true
      } else {
        // Not yet initialized - accept the point but don't count distance
        // Still add raw point to smoothed track so the display line is continuous
        this.smoothedTrack.push({ ...raw })

        const progress = calculateDistance(
          this.firstAcceptedPoint.longitude, this.firstAcceptedPoint.latitude,
          raw.longitude, raw.latitude
        ) / this.config.initDistance
        return {
          accepted: true,
          smoothedPoint: { ...raw },
          totalDistance: 0,
          bearing: null,
          isMoving: true,
          initProgress: Math.min(1, progress),
        }
      }
    }

    // 6. Savitzky-Golay smoothing (causal, on buffer)
    const smoothedPoint = this.applySGSmoothing(raw)
    this.smoothedTrack.push(smoothedPoint)

    // 7. Direction projection: compute forward distance
    if (this.smoothedTrack.length >= 2) {
      const prev = this.smoothedTrack[this.smoothedTrack.length - 2]
      const curr = smoothedPoint

      const segDist = calculateDistance(
        prev.longitude, prev.latitude,
        curr.longitude, curr.latitude
      )
      const segBearing = calculateBearing(
        prev.longitude, prev.latitude,
        curr.longitude, curr.latitude
      )

      // Only count forward component relative to current travel direction
      const angleDeviation = angleDiff(segBearing, this.bearing!)
      const forwardDist = segDist * Math.cos(angleDeviation)

      if (forwardDist > 0) {
        this.totalDistance += forwardDist
      }

      // Smoothly update bearing (exponential moving average on unit circle)
      if (segDist > 0.5) { // Only update bearing for meaningful segments
        const alpha = this.config.bearingAlpha
        const newBearing = this.bearing! + alpha * angleDiff(segBearing, this.bearing!)
        this.bearing = newBearing
      }
    }

    return {
      accepted: true,
      smoothedPoint,
      totalDistance: this.totalDistance,
      bearing: this.bearing,
      isMoving: true,
      initProgress: 1,
    }
  }

  /**
   * Apply causal Savitzky-Golay filter to produce a smoothed point.
   */
  private applySGSmoothing(fallback: GpsPoint): GpsPoint {
    const w = this.config.sgWindowSize

    if (this.buffer.length < w) {
      // Not enough points yet - return raw point
      return { ...fallback }
    }

    // Take last w points from buffer
    const window = this.buffer.slice(-w)

    let smoothLat = 0
    let smoothLon = 0
    for (let j = 0; j < w; j++) {
      smoothLat += this.sgCoeffs[j] * window[j].latitude
      smoothLon += this.sgCoeffs[j] * window[j].longitude
    }

    return {
      latitude: smoothLat,
      longitude: smoothLon,
      timestamp: fallback.timestamp,
      accuracy: fallback.accuracy,
    }
  }

  /**
   * Get the full smoothed track for map display.
   */
  getSmoothedTrack(): GpsPoint[] {
    return [...this.smoothedTrack]
  }

  /**
   * Reset the filter state (for a new run).
   */
  reset(): void {
    this.buffer = []
    this.smoothedTrack = []
    this.lastAcceptedPoint = null
    this.bearing = null
    this.totalDistance = 0
    this.isInitialized = false
    this.firstAcceptedPoint = null
  }
}

/**
 * Trim a GPS track to its monotone forward-progressing portion without
 * requiring a reference spline. Uses PCA to find the principal travel axis,
 * then keeps the segment from the backwards-most point in the first half to
 * the forwards-most point in the second half.
 *
 * This removes:
 *  - Walking backwards before the official run start
 *  - Walking backwards after the run ends
 *  - Brief back-and-forth at either end
 *
 * Brief mid-run reversals (a few points) are left to the subsequent SG
 * smoother to handle.
 */
function trimToMonotoneRange(track: GpsPoint[]): GpsPoint[] {
  if (track.length < 10) return track

  // --- Compute centroid ---
  let meanLat = 0
  let meanLon = 0
  for (const p of track) { meanLat += p.latitude; meanLon += p.longitude }
  meanLat /= track.length
  meanLon /= track.length

  // Metric scaling: approximate meters per degree at this latitude
  const latScale = 111320
  const lonScale = latScale * Math.cos(meanLat * Math.PI / 180)

  // --- PCA: 2×2 covariance matrix ---
  let cxx = 0, cxy = 0, cyy = 0
  for (const p of track) {
    const dx = (p.longitude - meanLon) * lonScale
    const dy = (p.latitude - meanLat) * latScale
    cxx += dx * dx
    cxy += dx * dy
    cyy += dy * dy
  }
  cxx /= track.length
  cxy /= track.length
  cyy /= track.length

  // Principal eigenvector (corresponds to largest eigenvalue)
  const trace = cxx + cyy
  const det = cxx * cyy - cxy * cxy
  const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det))
  const lambda1 = trace / 2 + disc

  let axisX: number
  let axisY: number
  if (Math.abs(cxy) > 1e-10) {
    axisX = lambda1 - cyy
    axisY = cxy
  } else {
    axisX = cxx >= cyy ? 1 : 0
    axisY = cxx >= cyy ? 0 : 1
  }
  const axisLen = Math.sqrt(axisX * axisX + axisY * axisY)
  axisX /= axisLen
  axisY /= axisLen

  // Orient axis so it aligns with the overall travel direction (first→last decile)
  const q10 = Math.floor(track.length * 0.1)
  const q90 = Math.min(track.length - 1, Math.floor(track.length * 0.9))
  const odx = (track[q90].longitude - track[q10].longitude) * lonScale
  const ody = (track[q90].latitude - track[q10].latitude) * latScale
  if (axisX * odx + axisY * ody < 0) { axisX = -axisX; axisY = -axisY }

  // --- Project all points onto the principal axis ---
  const proj = track.map(p => {
    const dx = (p.longitude - meanLon) * lonScale
    const dy = (p.latitude - meanLat) * latScale
    return dx * axisX + dy * axisY
  })

  // Smooth projections slightly to avoid noise picking wrong extremes
  const hw = Math.min(5, Math.floor(track.length / 4))
  const smoothProj = proj.map((_, i) => {
    const lo = Math.max(0, i - hw)
    const hi = Math.min(proj.length - 1, i + hw)
    let sum = 0
    for (let j = lo; j <= hi; j++) sum += proj[j]
    return sum / (hi - lo + 1)
  })

  const half = Math.floor(track.length / 2)

  // Start: last occurrence of minimum projection in the first half
  let minVal = smoothProj[0]
  let startIdx = 0
  for (let i = 0; i <= half; i++) {
    if (smoothProj[i] <= minVal) { minVal = smoothProj[i]; startIdx = i }
  }

  // End: first occurrence of maximum projection in the second half
  let maxVal = smoothProj[track.length - 1]
  let endIdx = track.length - 1
  for (let i = track.length - 1; i >= half; i--) {
    if (smoothProj[i] >= maxVal) { maxVal = smoothProj[i]; endIdx = i }
  }

  if (endIdx <= startIdx) return track
  return track.slice(startIdx, endIdx + 1)
}

/**
 * Remove hard positional outliers from a GPS track using a sliding-window
 * median filter (Hampel-style identifier).
 *
 * For each point, the median lat/lon is computed over the surrounding window.
 * If the point deviates more than maxDevMeters from that median it is
 * replaced by the median — suppressing GPS multipath spikes without
 * distorting the true track geometry.
 */
function removeGpsOutliers(
  track: GpsPoint[],
  halfWindow: number = 12,
  maxDevMeters: number = 10,
): GpsPoint[] {
  if (track.length < 3) return [...track]

  const n = track.length
  const result: GpsPoint[] = new Array(n)

  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfWindow)
    const hi = Math.min(n - 1, i + halfWindow)

    // Collect and sort window values for median
    const wLats: number[] = []
    const wLons: number[] = []
    for (let j = lo; j <= hi; j++) {
      wLats.push(track[j].latitude)
      wLons.push(track[j].longitude)
    }
    wLats.sort((a, b) => a - b)
    wLons.sort((a, b) => a - b)

    const mid = Math.floor(wLats.length / 2)
    const medLat = wLats.length % 2 === 0
      ? (wLats[mid - 1] + wLats[mid]) / 2
      : wLats[mid]
    const medLon = wLons.length % 2 === 0
      ? (wLons[mid - 1] + wLons[mid]) / 2
      : wLons[mid]

    const dev = calculateDistance(
      track[i].longitude, track[i].latitude,
      medLon, medLat,
    )

    result[i] = dev > maxDevMeters
      ? { ...track[i], latitude: medLat, longitude: medLon }
      : { ...track[i] }
  }

  return result
}

/**
 * Post-process a complete GPS track for export using a two-stage pipeline:
 *
 *  1. Hampel-style median filter: removes hard lateral outliers (GPS
 *     multipath spikes, bad readings at track start before GPS settles).
 *     A point is replaced by the window median when it deviates > 12 m.
 *
 *  2. Symmetric (non-causal) Savitzky-Golay filter: smooths the
 *     cleaned track into a proper arc. Because all points are available
 *     offline, the centered window is used — much better than the causal
 *     filter applied during live recording.
 *
 * Suitable for railway tracks: curves have large radii (≥ 150 m) and
 * there are no sharp corners.
 *
 * @param track       - Complete recorded GPS track
 * @param halfWindow  - Points on each side of center (default 20 → 41-point window)
 * @param polyOrder   - Polynomial degree (default 3 = cubic, follows circular arcs)
 */
export function smoothGpsTrackBatch(
  track: GpsPoint[],
  halfWindow: number = 40,
  polyOrder: number = 3
): GpsPoint[] {
  if (track.length < 3) return [...track]

  // Stage 1: suppress hard lateral spikes (Hampel median filter)
  const cleaned = removeGpsOutliers(track)

  // Stage 2: trim to the monotone forward-progressing portion
  // (removes back-and-forth at start/end, no spline required)
  const trimmed = trimToMonotoneRange(cleaned)

  // Stage 3: symmetric SG smoothing on the cleaned, trimmed track
  const n = trimmed.length
  const coeffCache = new Map<string, number[]>()

  function getCoeffs(windowSize: number, centerIdx: number): number[] {
    const p = Math.min(polyOrder, windowSize - 1)
    const key = `${windowSize}_${centerIdx}_${p}`
    const cached = coeffCache.get(key)
    if (cached) return cached

    // Vandermonde matrix with x-values centred on the evaluation point
    const J: number[][] = []
    for (let j = 0; j < windowSize; j++) {
      const x = j - centerIdx
      const row: number[] = []
      for (let k = 0; k <= p; k++) row.push(Math.pow(x, k))
      J.push(row)
    }

    const Jt = transpose(J)
    const JtJ = matMul(Jt, J)
    const JtJ_inv = invertMatrix(JtJ)
    const C = matMul(JtJ_inv, Jt)

    // Smoothed value at x = 0 → first row of (J^T J)^{-1} J^T
    const coeffs = C[0]
    coeffCache.set(key, coeffs)
    return coeffs
  }

  const result: GpsPoint[] = new Array(n)

  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfWindow)
    const hi = Math.min(n - 1, i + halfWindow)
    const winSize = hi - lo + 1
    const centerIdx = i - lo

    const coeffs = getCoeffs(winSize, centerIdx)

    let lat = 0
    let lon = 0
    for (let j = 0; j < winSize; j++) {
      lat += coeffs[j] * trimmed[lo + j].latitude
      lon += coeffs[j] * trimmed[lo + j].longitude
    }

    result[i] = {
      latitude: lat,
      longitude: lon,
      timestamp: trimmed[i].timestamp,
      accuracy: trimmed[i].accuracy,
    }
  }

  return result
}
