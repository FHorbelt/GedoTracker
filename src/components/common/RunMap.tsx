import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import { ChevronDown, ChevronUp, MapPin, Navigation, WifiOff, Maximize2, Minimize2, Route } from 'lucide-react'
import { FixedPoint, GpsPoint, DraggedTrajectoryPoint } from '../../db/models'
import { getCachedTile } from '../../utils/offlineTiles'
import { TrackInfo, PointSuggestion } from '../../utils/pointSuggestion'

// Fix for default marker icons in Leaflet with bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
})

// Custom icons
const fixedPointIcon = new L.Icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [20, 33],
  iconAnchor: [10, 33],
  popupAnchor: [0, -33],
  shadowSize: [33, 33],
})

// Navigation arrow SVG (points upward, rotated via CSS transform)
function createNavArrowIcon(color: string, strokeColor: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="${color}" stroke="${strokeColor}" stroke-width="1.5">
    <path d="M16 2 L26 28 L16 22 L6 28 Z" fill="${color}" stroke="${strokeColor}" stroke-linejoin="round"/>
  </svg>`
}

function makeNavIcon(color: string, strokeColor: string, bearingDeg: number): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:32px;height:32px;transform:rotate(${bearingDeg}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4))">
      <img src="data:image/svg+xml;base64,${btoa(createNavArrowIcon(color, strokeColor))}" style="width:100%;height:100%"/>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  })
}

// GPS position icon (yellow dot)
const currentPositionIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" fill="#eab308" stroke="#a16207" stroke-width="2"/>
      <circle cx="12" cy="12" r="3" fill="white"/>
    </svg>
  `),
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12],
})

const estimatedPositionIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(createNavArrowIcon('#f97316', '#c2410c')),
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
})

// Upcoming point icon (yellow)
const upcomingPointIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#eab308" stroke="#a16207" stroke-width="1">
      <circle cx="12" cy="12" r="6" fill="#eab308" stroke="#a16207" stroke-width="2"/>
    </svg>
  `),
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -8],
})

// Drag point icon (orange circle, draggable)
const createDragPointIcon = (isModified: boolean) => new L.DivIcon({
  className: 'drag-point-marker',
  html: `
    <div style="
      width: 20px;
      height: 20px;
      background: ${isModified ? '#22c55e' : '#f97316'};
      border: 3px solid ${isModified ? '#166534' : '#c2410c'};
      border-radius: 50%;
      cursor: grab;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    "></div>
  `,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -10],
})

// Haversine distance in meters between two lat/lon points
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Bearing in degrees (0=north, clockwise) between two lat/lon points
function bearingBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180
  const dLon = (lon2 - lon1) * toRad
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad)
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

// Sample label positions along a trajectory every `interval` meters,
// skipping positions near sharp bends to avoid overlapping text.
function sampleTrajectoryLabels(
  coordinates: [number, number][],  // [lat, lon][]
  interval: number
): { lat: number; lon: number; rotation: number }[] {
  if (coordinates.length < 2) return []

  // Pre-compute per-segment bearings and cumulative distances
  const segBearings: number[] = []
  const segDistances: number[] = []
  const cumDist: number[] = [0]

  for (let i = 1; i < coordinates.length; i++) {
    const [lat1, lon1] = coordinates[i - 1]
    const [lat2, lon2] = coordinates[i]
    segBearings.push(bearingBetween(lat1, lon1, lat2, lon2))
    const d = haversineDistance(lat1, lon1, lat2, lon2)
    segDistances.push(d)
    cumDist.push(cumDist[cumDist.length - 1] + d)
  }

  // Find distances of sharp vertices (bearing change > 30°)
  const SHARP_THRESHOLD = 30 // degrees
  const SHARP_BUFFER = 15    // meters — no labels within this distance of a sharp vertex
  const sharpDists: number[] = []

  for (let i = 1; i < segBearings.length; i++) {
    let diff = Math.abs(segBearings[i] - segBearings[i - 1])
    if (diff > 180) diff = 360 - diff
    if (diff > SHARP_THRESHOLD) {
      sharpDists.push(cumDist[i])
    }
  }

  // Sample labels, skipping those near sharp vertices
  const labels: { lat: number; lon: number; rotation: number }[] = []
  let accumulated = 0
  let nextLabelAt = interval / 2
  let segIdx = 0

  for (let i = 1; i < coordinates.length; i++) {
    const [lat1, lon1] = coordinates[i - 1]
    const [lat2, lon2] = coordinates[i]
    const segDist = segDistances[i - 1]
    segIdx = i - 1

    while (accumulated + segDist >= nextLabelAt) {
      // Check proximity to sharp vertices
      const nearSharp = sharpDists.some(d => Math.abs(nextLabelAt - d) < SHARP_BUFFER)

      if (!nearSharp) {
        const t = (nextLabelAt - accumulated) / segDist
        const lat = lat1 + t * (lat2 - lat1)
        const lon = lon1 + t * (lon2 - lon1)

        let cssRotation = segBearings[segIdx] - 90
        if (cssRotation > 180) cssRotation -= 360
        if (cssRotation < -180) cssRotation += 360
        if (cssRotation > 90) cssRotation -= 180
        if (cssRotation < -90) cssRotation += 180

        labels.push({ lat, lon, rotation: cssRotation })
      }

      nextLabelAt += interval
    }

    accumulated += segDist
  }

  return labels
}

type ClickMode = 'none' | 'start'

interface ReferenceTrajectoryDisplay {
  id: string
  name: string
  coordinates: [number, number][][]  // [lat, lon][][] — multi-polyline (one array per connected section)
}

interface RunMapProps {
  fixedPoints?: FixedPoint[]
  gpsTrack?: GpsPoint[]
  startPosition?: { latitude: number; longitude: number } | null
  currentPosition?: { latitude: number; longitude: number } | null
  onStartPositionSet?: (lat: number, lon: number) => void
  clickMode?: ClickMode  // What clicking does
  defaultExpanded?: boolean
  alwaysExpanded?: boolean  // If true, map is always visible without toggle
  defaultHeightExpanded?: boolean  // If true, map starts with expanded height
  fieldId?: string  // For offline tile cache
  trackInfo?: TrackInfo | null  // Track progress info
  upcomingPoints?: PointSuggestion[]  // Highlighted upcoming points
  preventAutoZoom?: boolean  // Prevent auto-zoom on data changes
  currentDistance?: number  // Current distance traveled - triggers re-centering when changed
  autoCenterOnDistance?: boolean  // Auto-center map when distance changes
  showSpline?: boolean  // Show spline curve on map
  // Draggable trajectory points for manual adjustment
  dragPoints?: DraggedTrajectoryPoint[]
  onDragPointUpdate?: (index: number, lat: number, lon: number) => void
  showDragPoints?: boolean  // Whether to show drag points on map
  // Reference trajectories (Solltrassen)
  referenceTrajectories?: ReferenceTrajectoryDisplay[]
  selectedTrajectoryId?: string | null
  onTrajectorySelect?: (id: string | null) => void
  // GPS follow mode
  followGps?: boolean
  followGpsTick?: number
  onFollowGpsChange?: (follow: boolean) => void
  // Fullscreen mode (for GNSS recording)
  fullscreen?: boolean
  // Nearby point badges for tap-to-save
  nearbyPoints?: PointSuggestion[]
  onPointTap?: (point: PointSuggestion) => void
  // GPS bearing in radians for navigation arrow
  gpsBearing?: number | null
}

// Create a custom TileLayer class with offline fallback
class OfflineCacheTileLayer extends L.TileLayer {
  private fieldId?: string

  constructor(url: string, options: L.TileLayerOptions & { fieldId?: string }) {
    super(url, options)
    this.fieldId = options.fieldId
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('img') as HTMLImageElement
    tile.alt = ''
    tile.setAttribute('role', 'presentation')

    const fieldId = this.fieldId

    const loadTile = async () => {
      // If offline and we have a fieldId, try cache first
      if (!navigator.onLine && fieldId) {
        try {
          const cachedUrl = await getCachedTile(fieldId, coords.x, coords.y, coords.z)
          if (cachedUrl) {
            tile.onload = () => {
              URL.revokeObjectURL(cachedUrl)
              done(undefined, tile)
            }
            tile.onerror = () => {
              URL.revokeObjectURL(cachedUrl)
              // Try online as fallback
              loadOnline()
            }
            tile.src = cachedUrl
            return
          }
        } catch (e) {
          console.error('Cache error:', e)
        }
      }

      // Load from online
      loadOnline()
    }

    const loadOnline = () => {
      const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${coords.z}/${coords.y}/${coords.x}`
      tile.onload = () => done(undefined, tile)
      tile.onerror = () => done(new Error('Tile load error'), tile)
      tile.src = url
    }

    loadTile()
    return tile
  }
}

// Custom tile layer component with offline fallback
function OfflineTileLayer({ fieldId }: { fieldId?: string }) {
  const map = useMap()
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const tileLayerRef = useRef<L.TileLayer | null>(null)

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    // Create custom tile layer with offline fallback
    const tileLayer = new OfflineCacheTileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '&copy; <a href="https://www.esri.com">Esri</a>',
        maxNativeZoom: 19,
        maxZoom: 21,
        fieldId,
      }
    )

    tileLayer.addTo(map)
    tileLayerRef.current = tileLayer

    return () => {
      if (tileLayerRef.current) {
        map.removeLayer(tileLayerRef.current)
      }
    }
  }, [map, fieldId])

  return isOffline ? (
    <div
      className="absolute bottom-2 left-2 z-[1000] flex items-center gap-1 px-2 py-1 rounded text-xs"
      style={{ backgroundColor: 'rgba(239, 68, 68, 0.9)', color: 'white' }}
    >
      <WifiOff className="w-3 h-3" />
      Offline
    </div>
  ) : null
}

// Component to handle map click events
function MapClickHandler({
  clickMode,
  onStartPositionSet,
}: {
  clickMode?: ClickMode
  onStartPositionSet?: (lat: number, lon: number) => void
}) {
  useMapEvents({
    click: (e) => {
      if (clickMode === 'start' && onStartPositionSet) {
        onStartPositionSet(e.latlng.lat, e.latlng.lng)
      }
    },
  })
  return null
}

// Component to fit bounds when data changes
function MapBoundsHandler({
  fixedPoints,
  gpsTrack,
  referenceTrajectories,
  preventAutoZoom
}: {
  fixedPoints?: FixedPoint[]
  gpsTrack?: GpsPoint[]
  referenceTrajectories?: ReferenceTrajectoryDisplay[]
  preventAutoZoom?: boolean
}) {
  const map = useMap()
  const hasFittedRef = useRef(false)

  useEffect(() => {
    // Only fit bounds once on initial load, or when GPS track grows significantly
    if (preventAutoZoom && hasFittedRef.current) return

    const points: [number, number][] = []

    // Add fixed points
    if (fixedPoints && fixedPoints.length > 0) {
      fixedPoints.forEach(p => points.push([p.latitude, p.longitude]))
    }

    // Add GPS track
    if (gpsTrack && gpsTrack.length > 0) {
      gpsTrack.forEach(p => points.push([p.latitude, p.longitude]))
    }

    // Add reference trajectory coordinates
    if (referenceTrajectories && referenceTrajectories.length > 0) {
      referenceTrajectories.forEach(traj => {
        traj.coordinates.forEach(seg => seg.forEach(coord => points.push(coord)))
      })
    }

    if (points.length > 0) {
      const bounds = L.latLngBounds(points)
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 19 })
      hasFittedRef.current = true
    }
  }, [map, fixedPoints, gpsTrack, referenceTrajectories, preventAutoZoom])

  return null
}

// Component to auto-center map on estimated position when distance changes
function MapCenterHandler({
  trackInfo,
  currentDistance,
  autoCenterOnDistance
}: {
  trackInfo?: TrackInfo | null
  currentDistance?: number
  autoCenterOnDistance?: boolean
}) {
  const map = useMap()
  const lastDistanceRef = useRef<number | undefined>(undefined)
  const hasInitializedRef = useRef(false)
  const MIN_ZOOM = 17  // Minimum zoom level for auto-centering

  useEffect(() => {
    // Only center if auto-center is enabled and we have a position to center on
    if (!autoCenterOnDistance || !trackInfo?.estimatedPosition) return

    const pos = trackInfo.estimatedPosition
    const currentZoom = map.getZoom()

    // Initial centering when first loading
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true
      lastDistanceRef.current = currentDistance
      // Zoom in if too far out, otherwise keep current zoom
      const targetZoom = currentZoom < MIN_ZOOM ? MIN_ZOOM : currentZoom
      map.setView([pos.latitude, pos.longitude], targetZoom, { animate: false })
      return
    }

    // Check if distance actually changed
    const distanceChanged = currentDistance !== undefined &&
                           currentDistance !== lastDistanceRef.current

    if (distanceChanged) {
      lastDistanceRef.current = currentDistance

      // Center on estimated position, keeping current zoom level (but ensure minimum)
      const targetZoom = currentZoom < MIN_ZOOM ? MIN_ZOOM : currentZoom
      map.setView(
        [pos.latitude, pos.longitude],
        targetZoom,
        { animate: true, duration: 0.25 }
      )
    }
  }, [map, trackInfo, currentDistance, autoCenterOnDistance])

  // Also center when trackInfo.estimatedPosition changes significantly
  useEffect(() => {
    if (!autoCenterOnDistance || !trackInfo?.estimatedPosition) return
    if (!hasInitializedRef.current) return // Wait for initial setup

    const pos = trackInfo.estimatedPosition
    const currentZoom = map.getZoom()
    const targetZoom = currentZoom < MIN_ZOOM ? MIN_ZOOM : currentZoom

    // Smoothly pan to new position
    map.panTo([pos.latitude, pos.longitude], { animate: true, duration: 0.25 })
  }, [map, trackInfo?.estimatedPosition?.latitude, trackInfo?.estimatedPosition?.longitude, autoCenterOnDistance])

  return null
}

// Component to follow GPS position on the map
function GpsFollowHandler({
  currentPosition,
  followGps,
  followGpsTick,
  onFollowGpsChange,
}: {
  currentPosition?: { latitude: number; longitude: number } | null
  followGps?: boolean
  followGpsTick?: number
  onFollowGpsChange?: (follow: boolean) => void
}) {
  const map = useMap()
  const isFollowingRef = useRef(followGps)

  // Track followGps prop changes
  useEffect(() => {
    isFollowingRef.current = followGps
  }, [followGps])

  // Detect manual pan/zoom to disable follow
  useMapEvents({
    dragstart: () => {
      if (isFollowingRef.current) {
        isFollowingRef.current = false
        onFollowGpsChange?.(false)
      }
    },
  })

  // Center on GPS when following or when button is pressed (tick changes)
  useEffect(() => {
    if (!followGps || !currentPosition) return
    const currentZoom = map.getZoom()
    const targetZoom = currentZoom < 17 ? 17 : currentZoom
    map.setView(
      [currentPosition.latitude, currentPosition.longitude],
      targetZoom,
      { animate: true, duration: 0.3 }
    )
  }, [map, followGps, followGpsTick, currentPosition?.latitude, currentPosition?.longitude])

  return null
}

// Component to handle map resize when height changes
function MapResizeHandler({ isHeightExpanded, fullscreen }: { isHeightExpanded: boolean; fullscreen?: boolean }) {
  const map = useMap()

  useEffect(() => {
    // Immediate + delayed invalidation to handle both instant and CSS-transition-based size changes
    map.invalidateSize()
    const timeout = setTimeout(() => {
      map.invalidateSize()
    }, 350)

    return () => clearTimeout(timeout)
  }, [map, isHeightExpanded, fullscreen])

  return null
}

// Renders trajectory name labels along the polyline, spaced dynamically by zoom level
function TrajectoryLabels({
  trajectory,
  isSelected,
}: {
  trajectory: ReferenceTrajectoryDisplay
  isSelected: boolean
}) {
  const map = useMap()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [, setRenderTick] = useState(0)

  // Force re-render on zoom/move so pixel coordinates update
  useEffect(() => {
    const update = () => setRenderTick(t => t + 1)
    map.on('zoomend', update)
    map.on('moveend', update)
    return () => {
      map.off('zoomend', update)
      map.off('moveend', update)
    }
  }, [map])

  // Attach SVG overlay to the map's overlay pane once
  useEffect(() => {
    const pane = map.getPane('overlayPane')
    if (!pane) return
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('style', 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:450')
    pane.appendChild(svg)
    svgRef.current = svg
    setRenderTick(t => t + 1)
    return () => {
      pane.removeChild(svg)
      svgRef.current = null
    }
  }, [map])

  // Render rotated text labels into the SVG overlay after every render
  const labelColor = isSelected ? '#86efac' : '#ffffff'
  const fontWeight = isSelected ? 600 : 500

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    svg.innerHTML = ''

    const zoom = map.getZoom()
    const baseZoom = 19
    const interval = 60 * Math.pow(2, Math.max(0, baseZoom - zoom))
    const labels = sampleTrajectoryLabels(trajectory.coordinates.flat(), interval)

    labels.forEach(label => {
      const pt = map.latLngToLayerPoint(L.latLng(label.lat, label.lon))

      // Group with position + rotation transform so text follows the track direction
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      g.setAttribute('transform', `translate(${pt.x},${pt.y}) rotate(${label.rotation})`)

      // Dark halo for contrast against any map background
      const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      shadow.setAttribute('text-anchor', 'middle')
      shadow.setAttribute('dominant-baseline', 'middle')
      shadow.setAttribute('font-size', '11')
      shadow.setAttribute('font-weight', String(fontWeight))
      shadow.setAttribute('fill', 'rgba(0,0,0,0.9)')
      shadow.setAttribute('stroke', 'rgba(0,0,0,0.7)')
      shadow.setAttribute('stroke-width', '3')
      shadow.setAttribute('stroke-linejoin', 'round')
      shadow.textContent = trajectory.name
      g.appendChild(shadow)

      // Foreground label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      text.setAttribute('text-anchor', 'middle')
      text.setAttribute('dominant-baseline', 'middle')
      text.setAttribute('font-size', '11')
      text.setAttribute('font-weight', String(fontWeight))
      text.setAttribute('fill', labelColor)
      text.textContent = trajectory.name
      g.appendChild(text)

      svg.appendChild(g)
    })
  })

  return null
}

// Handle zoomToTrajectory custom event from fullscreen overlays
function ZoomToTrajectoryHandler({ referenceTrajectories }: { referenceTrajectories?: ReferenceTrajectoryDisplay[] }) {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    const handler = () => {
      if (referenceTrajectories && referenceTrajectories.length > 0) {
        const points: [number, number][] = []
        referenceTrajectories.forEach(traj => {
          traj.coordinates.forEach(seg => seg.forEach(coord => points.push(coord)))
        })
        if (points.length > 0) {
          const bounds = L.latLngBounds(points)
          map.fitBounds(bounds, { padding: [30, 30], maxZoom: 19, animate: true })
        }
      }
    }
    container.addEventListener('zoomToTrajectory', handler)
    return () => container.removeEventListener('zoomToTrajectory', handler)
  }, [map, referenceTrajectories])
  return null
}

// Rotates the map pane to follow heading (bearing in radians)
function MapRotationHandler({ bearing, enabled }: { bearing: number | null | undefined; enabled: boolean }) {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    const pane = container.querySelector('.leaflet-map-pane') as HTMLElement | null
    if (!pane) return

    if (enabled && bearing != null) {
      const deg = ((bearing * 180 / Math.PI) + 360) % 360
      // Rotate map pane inversely so heading points up
      pane.style.transformOrigin = 'center center'
      pane.style.transition = 'transform 0.5s ease-out'
      pane.style.transform = `rotate(${-deg}deg)`
    } else {
      pane.style.transition = 'transform 0.5s ease-out'
      pane.style.transform = ''
    }

    return () => {
      pane.style.transform = ''
      pane.style.transition = ''
    }
  }, [map, bearing, enabled])

  return null
}

// Zoom control buttons for GPS and trajectories
function MapZoomControls({
  currentPosition,
  referenceTrajectories,
}: {
  currentPosition?: { latitude: number; longitude: number } | null
  referenceTrajectories?: ReferenceTrajectoryDisplay[]
}) {
  const map = useMap()

  const hasGps = !!currentPosition
  const hasTrajectories = referenceTrajectories && referenceTrajectories.length > 0 &&
    referenceTrajectories.some(t => t.coordinates.length > 0)

  // Only show if we have at least one option to zoom to
  if (!hasGps && !hasTrajectories) return null

  const zoomToGps = () => {
    if (currentPosition) {
      map.setView([currentPosition.latitude, currentPosition.longitude], 19, { animate: true })
    }
  }

  const zoomToTrajectories = () => {
    if (referenceTrajectories && referenceTrajectories.length > 0) {
      const points: [number, number][] = []
      referenceTrajectories.forEach(traj => {
        traj.coordinates.forEach(seg => seg.forEach(coord => points.push(coord)))
      })
      if (points.length > 0) {
        const bounds = L.latLngBounds(points)
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 19, animate: true })
      }
    }
  }

  return (
    <div className="absolute top-2 right-2 z-[1000] flex flex-col gap-2">
      {hasGps && (
        <button
          type="button"
          onClick={zoomToGps}
          className="w-11 h-11 rounded-lg shadow-lg flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: 'white' }}
          title="Auf GPS-Position zoomen"
        >
          <Navigation className="w-5 h-5" />
        </button>
      )}
      {hasTrajectories && (
        <button
          type="button"
          onClick={zoomToTrajectories}
          className="w-11 h-11 rounded-lg shadow-lg flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.75)', color: 'white' }}
          title="Auf Trajektorien zoomen"
        >
          <Route className="w-5 h-5" />
        </button>
      )}
    </div>
  )
}

export function RunMap({
  fixedPoints = [],
  gpsTrack = [],
  startPosition,
  currentPosition,
  onStartPositionSet,
  clickMode = 'none',
  defaultExpanded = false,
  alwaysExpanded = false,
  defaultHeightExpanded = false,
  fieldId,
  trackInfo,
  upcomingPoints = [],
  preventAutoZoom = false,
  currentDistance,
  autoCenterOnDistance = false,
  showSpline = true,
  dragPoints = [],
  onDragPointUpdate,
  showDragPoints = false,
  referenceTrajectories = [],
  selectedTrajectoryId,
  onTrajectorySelect,
  followGps = false,
  followGpsTick,
  onFollowGpsChange,
  fullscreen = false,
  nearbyPoints = [],
  onPointTap,
  gpsBearing,
}: RunMapProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || alwaysExpanded)
  const [isHeightExpanded, setIsHeightExpanded] = useState(defaultHeightExpanded)
  const [headingUp, setHeadingUp] = useState(false)

  // Fullscreen: fill parent container (fixed positioned by RunEditor). Normal: fixed heights.
  const mapHeight = fullscreen ? '100%' : (isHeightExpanded ? '70vh' : '350px')

  // Calculate center from available data
  const center = useMemo(() => {
    if (currentPosition) {
      return [currentPosition.latitude, currentPosition.longitude] as [number, number]
    }
    if (trackInfo?.estimatedPosition) {
      return [trackInfo.estimatedPosition.latitude, trackInfo.estimatedPosition.longitude] as [number, number]
    }
    if (startPosition) {
      return [startPosition.latitude, startPosition.longitude] as [number, number]
    }
    if (gpsTrack.length > 0) {
      const last = gpsTrack[gpsTrack.length - 1]
      return [last.latitude, last.longitude] as [number, number]
    }
    if (fixedPoints.length > 0) {
      // Calculate center of fixed points
      const avgLat = fixedPoints.reduce((sum, p) => sum + p.latitude, 0) / fixedPoints.length
      const avgLon = fixedPoints.reduce((sum, p) => sum + p.longitude, 0) / fixedPoints.length
      return [avgLat, avgLon] as [number, number]
    }
    if (referenceTrajectories.length > 0) {
      // Calculate center of all trajectory coordinates
      const allCoords = referenceTrajectories.flatMap(t => t.coordinates.flat())
      if (allCoords.length > 0) {
        const avgLat = allCoords.reduce((sum, c) => sum + c[0], 0) / allCoords.length
        const avgLon = allCoords.reduce((sum, c) => sum + c[1], 0) / allCoords.length
        return [avgLat, avgLon] as [number, number]
      }
    }
    // Default: Germany center
    return [51.1657, 10.4515] as [number, number]
  }, [fixedPoints, gpsTrack, startPosition, currentPosition, trackInfo, referenceTrajectories])


  // IDs of upcoming points for highlighting
  const upcomingPointIds = useMemo(() => {
    return new Set(upcomingPoints.map(p => p.point.id))
  }, [upcomingPoints])

  // GPS track as polyline coordinates
  const trackLine = useMemo(() => {
    return gpsTrack.map(p => [p.latitude, p.longitude] as [number, number])
  }, [gpsTrack])

  // Dynamic nav-arrow icon for estimated position
  const estimatedNavIcon = useMemo(() => {
    if (!trackInfo?.bearing) return estimatedPositionIcon
    const deg = ((trackInfo.bearing * 180 / Math.PI) + 360) % 360
    return makeNavIcon('#f97316', '#c2410c', deg)
  }, [trackInfo?.bearing])

  return (
    <div className={fullscreen ? 'overflow-hidden' : 'rounded-lg overflow-hidden'} style={fullscreen ? { height: '100%' } : { border: '1px solid var(--color-border)' }}>
      {/* Header - hide in fullscreen mode */}
      {fullscreen ? null : !alwaysExpanded ? (
        <div
          className="w-full flex items-center justify-between p-3"
          style={{ backgroundColor: 'var(--color-bg-card)' }}
        >
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 flex-1"
          >
            <MapPin className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
            <span className="font-medium" style={{ color: 'var(--color-text)' }}>
              {t('runs.map') || 'Karte'}
            </span>
            {fixedPoints.length > 0 && (
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                ({fixedPoints.length} {t('fixedpoints.pointCount') || 'Punkte'})
              </span>
            )}
          </button>
          <div className="flex items-center gap-2">
            {isExpanded && (
              <button
                type="button"
                onClick={() => setIsHeightExpanded(!isHeightExpanded)}
                className="p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                title={isHeightExpanded ? 'Karte verkleinern' : 'Karte vergrößern'}
              >
                {isHeightExpanded ? (
                  <Minimize2 className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                ) : (
                  <Maximize2 className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
                )}
              </button>
            )}
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
            ) : (
              <ChevronDown className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
            )}
          </div>
        </div>
      ) : (
        <div
          className="w-full flex items-center justify-between p-3"
          style={{ backgroundColor: 'var(--color-bg-card)' }}
        >
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
            <span className="font-medium" style={{ color: 'var(--color-text)' }}>
              {t('runs.map') || 'Karte'}
            </span>
            {fixedPoints.length > 0 && (
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                ({fixedPoints.length} {t('fixedpoints.pointCount') || 'Punkte'})
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsHeightExpanded(!isHeightExpanded)}
            className="p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
            title={isHeightExpanded ? 'Karte verkleinern' : 'Karte vergrößern'}
          >
            {isHeightExpanded ? (
              <Minimize2 className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
            ) : (
              <Maximize2 className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
            )}
          </button>
        </div>
      )}

      {/* Map */}
      {(isExpanded || alwaysExpanded || fullscreen) && (
        <div className="relative" style={fullscreen ? { height: '100%' } : undefined}>
          {clickMode === 'start' && (
            <div
              className="absolute top-2 left-2 right-2 z-[1000] p-2 rounded text-sm text-center"
              style={{
                backgroundColor: 'rgba(34, 197, 94, 0.9)',
                color: 'white',
              }}
            >
              {t('runs.tapToSetStart') || 'Tippen Sie auf die Strecke um den Startpunkt zu setzen'}
            </div>
          )}
          {showDragPoints && dragPoints.length > 0 && (
            <div
              className="absolute top-2 left-2 right-2 z-[1000] p-2 rounded text-sm text-center"
              style={{
                backgroundColor: 'rgba(249, 115, 22, 0.9)',
                color: 'white',
              }}
            >
              {t('trajectory.dragPointsHint') || 'Ziehen Sie die orangenen Punkte um die Trajektorie anzupassen'}
            </div>
          )}
          <MapContainer
            center={center}
            zoom={14}
            maxZoom={21}
            zoomControl={!fullscreen}
            style={{ height: mapHeight, width: '100%', transition: 'height 0.3s ease' }}
            scrollWheelZoom={true}
          >
            <OfflineTileLayer fieldId={fieldId} />
            <MapRotationHandler bearing={gpsBearing} enabled={headingUp} />

            <MapClickHandler
              clickMode={clickMode}
              onStartPositionSet={onStartPositionSet}
            />

            <MapBoundsHandler
              fixedPoints={fixedPoints}
              gpsTrack={gpsTrack}
              referenceTrajectories={referenceTrajectories}
              preventAutoZoom={preventAutoZoom}
            />

            <MapCenterHandler
              trackInfo={trackInfo}
              currentDistance={currentDistance}
              autoCenterOnDistance={autoCenterOnDistance}
            />

            <MapResizeHandler isHeightExpanded={isHeightExpanded} fullscreen={fullscreen} />

            <GpsFollowHandler
              currentPosition={currentPosition}
              followGps={followGps}
              followGpsTick={followGpsTick}
              onFollowGpsChange={onFollowGpsChange}
            />

            {fullscreen && (
              <ZoomToTrajectoryHandler referenceTrajectories={referenceTrajectories} />
            )}

            {!fullscreen && (
              <MapZoomControls
                currentPosition={currentPosition}
                referenceTrajectories={referenceTrajectories}
              />
            )}

            {/* Fixed points */}
            {fixedPoints.filter(p => p.latitude != null && p.longitude != null).map(point => (
              <Marker
                key={point.id}
                position={[point.latitude, point.longitude]}
                icon={fixedPointIcon}
              >
                <Tooltip
                  permanent
                  direction="right"
                  offset={[12, 0]}
                  className="point-number-label"
                >
                  {point.pointNumber}
                </Tooltip>
                <Popup>
                  <div className="text-sm">
                    <strong>{point.pointNumber}</strong>
                    {point.type && <div className="text-gray-500">{point.type}</div>}
                    <div className="text-xs text-gray-400 mt-1">
                      {point.latitude?.toFixed(6)}, {point.longitude?.toFixed(6)}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Draggable trajectory adjustment points */}
            {showDragPoints && dragPoints.length > 0 && dragPoints.map((dp) => {
              const isModified = dp.adjustedLat !== dp.originalLat || dp.adjustedLon !== dp.originalLon
              return (
                <Marker
                  key={`drag-${dp.index}`}
                  position={[dp.adjustedLat, dp.adjustedLon]}
                  icon={createDragPointIcon(isModified)}
                  draggable={true}
                  eventHandlers={{
                    dragend: (e) => {
                      const marker = e.target
                      const position = marker.getLatLng()
                      if (onDragPointUpdate) {
                        onDragPointUpdate(dp.index, position.lat, position.lng)
                      }
                    }
                  }}
                >
                  <Popup>
                    <div className="text-sm">
                      <strong>{t('trajectory.controlPoint') || 'Kontrollpunkt'} {dp.index}</strong>
                      {isModified && (
                        <div className="text-xs text-green-600">
                          {t('trajectory.modified') || 'Angepasst'}
                        </div>
                      )}
                      <div className="text-xs text-gray-400 mt-1">
                        {dp.adjustedLat.toFixed(6)}, {dp.adjustedLon.toFixed(6)}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              )
            })}

            {/* Reference trajectories (Solltrassen) */}
            {referenceTrajectories.map(traj => {
              const isSelected = selectedTrajectoryId === traj.id
              return (
                <span key={`refTraj-${traj.id}`}>
                  <Polyline
                    positions={traj.coordinates}
                    pathOptions={{
                      color: isSelected ? '#22c55e' : '#f59e0b',
                      weight: isSelected ? 5 : 3,
                      opacity: isSelected ? 0.9 : 0.6,
                    }}
                    eventHandlers={{
                      click: (e) => {
                        // When in start-point mode, forward click to map handler instead of toggling trajectory
                        if (clickMode === 'start' && onStartPositionSet) {
                          onStartPositionSet(e.latlng.lat, e.latlng.lng)
                          return
                        }
                        if (onTrajectorySelect) {
                          onTrajectorySelect(isSelected ? null : traj.id)
                        }
                      }
                    }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <strong>{traj.name}</strong>
                        <div className="text-xs text-gray-500">
                          {isSelected ? 'Ausgewählt' : 'Tippen zum Auswählen'}
                        </div>
                      </div>
                    </Popup>
                  </Polyline>
                  <TrajectoryLabels trajectory={traj} isSelected={isSelected} />
                </span>
              )
            })}

            {/* Spline curve through fixed points */}
            {showSpline && trackInfo?.splineCoordinates && trackInfo.splineCoordinates.length > 1 && (
              <Polyline
                positions={trackInfo.splineCoordinates}
                pathOptions={{ color: '#8b5cf6', weight: 4, opacity: 0.8 }}
              />
            )}

            {/* Direction arrow at start position */}
            {startPosition && trackInfo?.bearing !== undefined && (() => {
              const deg = ((trackInfo.bearing * 180 / Math.PI) + 360) % 360
              const icon = makeNavIcon('#22c55e', '#15803d', deg)
              return (
                <Marker
                  position={[startPosition.latitude, startPosition.longitude]}
                  icon={icon}
                >
                  <Popup>
                    <div className="text-sm">
                      <strong>{t('runs.startPosition') || 'Startposition'}</strong>
                      <div className="text-xs text-gray-500">{deg.toFixed(0)}°</div>
                    </div>
                  </Popup>
                </Marker>
              )
            })()}

            {/* GPS track */}
            {trackLine.length > 1 && (
              <Polyline
                positions={trackLine}
                pathOptions={{ color: '#eab308', weight: 3 }}
              />
            )}

            {/* Current GPS position (navigation arrow or yellow dot) */}
            {currentPosition && (
              <Marker
                position={[currentPosition.latitude, currentPosition.longitude]}
                icon={gpsBearing != null
                  ? makeNavIcon('#eab308', '#a16207', ((gpsBearing * 180 / Math.PI) + 360) % 360)
                  : currentPositionIcon}
              >
                <Popup>
                  <div className="text-sm">
                    <strong>{t('runs.currentPosition') || 'Aktuelle Position'}</strong>
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Estimated position (orange navigation arrow) */}
            {trackInfo?.estimatedPosition && (
              <Marker
                position={[trackInfo.estimatedPosition.latitude, trackInfo.estimatedPosition.longitude]}
                icon={estimatedNavIcon}
              >
                <Popup>
                  <div className="text-sm">
                    <strong>{t('runs.estimatedPosition') || 'Geschätzte Position'}</strong>
                    {trackInfo.bearing !== undefined && (
                      <div className="text-xs text-gray-500">{(((trackInfo.bearing * 180 / Math.PI) + 360) % 360).toFixed(0)}°</div>
                    )}
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Upcoming points (yellow markers) */}
            {upcomingPoints.map(suggestion => (
              <Marker
                key={`upcoming-${suggestion.point.id}`}
                position={[suggestion.point.latitude, suggestion.point.longitude]}
                icon={upcomingPointIcon}
              >
                <Popup>
                  <div className="text-sm">
                    <strong>{suggestion.point.pointNumber}</strong>
                    <div className="text-xs text-gray-500">
                      ~{Math.round(suggestion.distance)}m
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Nearby point badges (tappable, for GNSS fullscreen mode) */}
            {nearbyPoints.map(suggestion => {
              const isLeft = suggestion.suggestedSide === 'left'
              const opacity = Math.max(0.5, 1 - Math.abs(suggestion.distance) / 15)
              const size = Math.max(28, 40 - Math.abs(suggestion.distance) * 1.5)
              const bgColor = isLeft ? 'rgba(59,130,246,0.85)' : 'rgba(249,115,22,0.85)'
              const borderColor = isLeft ? '#2563eb' : '#c2410c'
              return (
                <Marker
                  key={`nearby-${suggestion.point.id}`}
                  position={[suggestion.point.latitude, suggestion.point.longitude]}
                  icon={L.divIcon({
                    className: '',
                    html: `<div style="
                      min-width:${size}px;
                      padding:2px 6px;
                      background:${bgColor};
                      border:2px solid ${borderColor};
                      border-radius:6px;
                      color:white;
                      font-size:11px;
                      font-weight:600;
                      text-align:center;
                      white-space:nowrap;
                      opacity:${opacity};
                      box-shadow:0 2px 6px rgba(0,0,0,0.4);
                      cursor:pointer;
                    ">${suggestion.point.pointNumber} <span style="font-size:9px">${isLeft ? 'L' : 'R'}</span></div>`,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0],
                  })}
                  eventHandlers={{
                    click: () => onPointTap?.(suggestion)
                  }}
                />
              )
            })}
          </MapContainer>
          {/* Heading-up / North-up toggle (only in fullscreen with GPS bearing) */}
          {fullscreen && gpsBearing != null && (
            <button
              type="button"
              onClick={() => setHeadingUp(prev => !prev)}
              className="absolute bottom-4 right-4 z-[1000] w-12 h-12 rounded-full shadow-lg flex items-center justify-center"
              style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
              title={headingUp ? 'Genordet' : 'Fahrtrichtung'}
            >
              {headingUp ? (
                // Heading-up icon (arrow pointing up)
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L12 22" />
                  <path d="M5 9l7-7 7 7" />
                </svg>
              ) : (
                // North-up icon (compass)
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <text x="12" y="16" textAnchor="middle" fill="white" stroke="none" fontSize="12" fontWeight="bold">N</text>
                </svg>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
