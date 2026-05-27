import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { Modal } from '../components/common/Modal'
import { useTheme } from '../contexts/ThemeContext'
import { Info, Calculator, Upload, Eye, Image, X, ChevronLeft, ChevronRight } from 'lucide-react'

interface Point3D {
  x: string
  y: string
  z: string
}

interface NumPoint {
  x: number
  y: number
  z: number
}

interface Result {
  dmi: NumPoint
  gams: NumPoint
}

interface ComputeResult {
  result: Result
  inputPts: NumPoint[]
  finalPts: NumPoint[]
}

const POINT_LABELS = [
  { de: 'Punkt 1 (Richtung Fuß)', en: 'Point 1 (Direction Foot)' },
  { de: 'Punkt 2 (Richtung Spitze)', en: 'Point 2 (Direction Tip)' },
  { de: 'Punkt 3 (Referenz MX9)', en: 'Point 3 (Reference MX9)' },
  { de: 'Punkt 4 (DMI)', en: 'Point 4 (DMI)' },
  { de: 'Punkt 5 (GAMS)', en: 'Point 5 (GAMS)' },
]

const POINT_COLORS = ['#f59e0b', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6']

// Labels for diagrams (only P3-P5 shown)
const VIS_LABELS_DE: Record<number, string> = { 2: 'Referenz', 3: 'DMI', 4: 'GAMS' }
const VIS_LABELS_EN: Record<number, string> = { 2: 'Reference', 3: 'DMI', 4: 'GAMS' }

function parseNum(s: string): number {
  return parseFloat(s.replace(',', '.'))
}

function compute(points: Point3D[], phaseOffsetM: number): ComputeResult | null {
  const pts = points.map(p => ({
    x: parseNum(p.x),
    y: parseNum(p.y),
    z: parseNum(p.z),
  }))

  if (pts.some(p => isNaN(p.x) || isNaN(p.y) || isNaN(p.z))) return null

  // Apply GAMS phase center offset to Z height (offset is upward, so add to Z)
  pts[4].z += phaseOffsetM

  const inputPts = pts.map(p => ({ ...p }))

  // Step 1: Translate all points so P3 becomes origin
  const ref = pts[2]
  const translated = pts.map(p => ({
    x: p.x - ref.x,
    y: p.y - ref.y,
    z: p.z - ref.z,
  }))

  // Step 2: Direction vector P1→P2
  const v = {
    x: translated[1].x - translated[0].x,
    y: translated[1].y - translated[0].y,
    z: translated[1].z - translated[0].z,
  }

  // Step 3: Yaw rotation (around Z-axis)
  const yawAngle = -Math.atan2(v.y, v.x)
  const cosYaw = Math.cos(yawAngle)
  const sinYaw = Math.sin(yawAngle)

  const afterYaw = translated.map(p => ({
    x: p.x * cosYaw - p.y * sinYaw,
    y: p.x * sinYaw + p.y * cosYaw,
    z: p.z,
  }))

  // Step 4: Pitch rotation (around Y-axis)
  const vYaw = {
    x: afterYaw[1].x - afterYaw[0].x,
    y: afterYaw[1].y - afterYaw[0].y,
    z: afterYaw[1].z - afterYaw[0].z,
  }
  const horizontalDist = Math.sqrt(vYaw.x * vYaw.x + vYaw.y * vYaw.y)
  const pitchAngle = Math.atan2(vYaw.z, horizontalDist)
  const cosPitch = Math.cos(pitchAngle)
  const sinPitch = Math.sin(pitchAngle)

  const finalPts = afterYaw.map(p => ({
    x: p.x * cosPitch + p.z * sinPitch,
    y: p.y,
    z: -p.x * sinPitch + p.z * cosPitch,
  }))

  return {
    result: {
      dmi: { x: finalPts[3].x, y: -finalPts[3].y, z: -finalPts[3].z },
      gams: { x: finalPts[4].x, y: -finalPts[4].y, z: -finalPts[4].z },
    },
    inputPts,
    finalPts,
  }
}

function formatValue(v: number): string {
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(4)} m`
}

function parseCSV(text: string): Point3D[] | null {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (lines.length < 5) return null

  const points: (Point3D | null)[] = [null, null, null, null, null]
  let assigned = 0

  for (const line of lines) {
    if (assigned >= 5) break
    let parts: string[]

    if (line.includes(';')) {
      parts = line.split(';').map(s => s.trim())
    } else {
      parts = line.split(',').map(s => s.trim())
    }

    if (parts.length < 4) return null

    const pointNum = parseInt(parts[0], 10)
    if (isNaN(pointNum) || pointNum < 1 || pointNum > 5) return null

    const x = parts[1].replace(',', '.')
    const y = parts[2].replace(',', '.')
    const z = parts[3].replace(',', '.')
    points[pointNum - 1] = { x, y, z }
    assigned++
  }

  if (points.some(p => p === null)) return null

  return points as Point3D[]
}

// ── Visualization Component ──

interface VisualizationProps {
  inputPts: NumPoint[]
  finalPts: NumPoint[]
  isDark: boolean
  isDE: boolean
}

function CoordinateVisualization({ inputPts, finalPts, isDark, isDE }: VisualizationProps) {
  const textColor = isDark ? '#ffffff' : '#1e293b'
  const mutedColor = isDark ? 'rgba(255,255,255,0.5)' : '#94a3b8'
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'

  function fitPoints(pts: { a: number; b: number }[], w: number, h: number, pad: number) {
    const xs = pts.map(p => p.a)
    const ys = pts.map(p => p.b)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const rangeX = maxX - minX || 1
    const rangeY = maxY - minY || 1
    const scale = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY)
    const cx = w / 2
    const cy = h / 2
    const midX = (minX + maxX) / 2
    const midY = (minY + maxY) / 2
    return (a: number, b: number) => ({
      sx: cx + (a - midX) * scale,
      sy: cy - (b - midY) * scale,
    })
  }

  const svgW = 320
  const svgH = 260
  const pad = 45

  // Indices to show: P3(2), P4(3), P5(4)
  const visibleIndices = [2, 3, 4]

  // ── Survey view ──
  const surveyAB = inputPts.map(p => ({ a: p.x, b: p.y }))
  const surveyVisible = visibleIndices.map(i => surveyAB[i])
  const mapSurvey = fitPoints(surveyVisible, svgW, svgH, pad)

  // ── MX9 view ──
  const mx9AB = finalPts.map(p => ({ a: -p.y, b: p.x }))
  const mx9Visible = visibleIndices.map(i => mx9AB[i])
  const mapMX9 = fitPoints(mx9Visible, svgW, svgH, pad)

  const arrowMarker = (id: string, color: string) => (
    <marker id={id} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill={color} />
    </marker>
  )

  const gridLines = (w: number, h: number) => {
    const lines = []
    const step = 40
    for (let x = step; x < w; x += step) {
      lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={h} stroke={gridColor} strokeWidth={0.5} />)
    }
    for (let y = step; y < h; y += step) {
      lines.push(<line key={`h${y}`} x1={0} y1={y} x2={w} y2={y} stroke={gridColor} strokeWidth={0.5} />)
    }
    return lines
  }

  // Direction arrow from P3 using P1→P2 vector
  const renderDirectionFromP3 = (
    abAll: { a: number; b: number }[],
    mapFn: (a: number, b: number) => { sx: number; sy: number },
    markerId: string,
  ) => {
    const p3 = mapFn(abAll[2].a, abAll[2].b)
    const dx = abAll[1].a - abAll[0].a
    const dy = abAll[1].b - abAll[0].b
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 0.0001) return null
    const arrowLen = 40
    const ex = p3.sx + (dx / len) * arrowLen
    const ey = p3.sy - (dy / len) * arrowLen
    return (
      <g>
        <line
          x1={p3.sx} y1={p3.sy} x2={ex} y2={ey}
          stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3"
          markerEnd={`url(#${markerId})`} opacity={0.7}
        />
        <text x={ex + 5} y={ey - 5} fill="#f59e0b" fontSize={9} fontWeight={600} opacity={0.8}>
          {isDE ? 'Fahrtrichtung' : 'Travel dir.'}
        </text>
      </g>
    )
  }

  // Crosshair at P3
  const renderCrosshair = (mapFn: (a: number, b: number) => { sx: number; sy: number }, abAll: { a: number; b: number }[]) => {
    const { sx, sy } = mapFn(abAll[2].a, abAll[2].b)
    return (
      <>
        <line x1={sx - 10} y1={sy} x2={sx + 10} y2={sy} stroke="#22c55e" strokeWidth={1} opacity={0.5} />
        <line x1={sx} y1={sy - 10} x2={sx} y2={sy + 10} stroke="#22c55e" strokeWidth={1} opacity={0.5} />
      </>
    )
  }

  // Render visible points with labels
  const renderPoints = (abAll: { a: number; b: number }[], mapFn: (a: number, b: number) => { sx: number; sy: number }) => (
    visibleIndices.map(i => {
      const { sx, sy } = mapFn(abAll[i].a, abAll[i].b)
      const label = isDE ? VIS_LABELS_DE[i] : VIS_LABELS_EN[i]
      return (
        <g key={i}>
          <circle cx={sx} cy={sy} r={i === 2 ? 7 : 5} fill={POINT_COLORS[i]} opacity={0.9} />
          <text x={sx + 9} y={sy + 4} fill={textColor} fontSize={10} fontWeight={600}>
            {label}
          </text>
        </g>
      )
    })
  )

  return (
    <div className="space-y-5">
      {/* Survey coordinate system */}
      <div>
        <h4 className="text-sm font-semibold mb-2" style={{ color: textColor }}>
          {isDE ? 'Eingabe: Vermessungskoordinaten' : 'Input: Survey Coordinates'}
        </h4>
        <p className="text-xs mb-2" style={{ color: mutedColor }}>
          {isDE
            ? 'Rechtswert → horizontal, Hochwert → vertikal, Höhe → aus Bildebene'
            : 'Easting → horizontal, Northing → vertical, Height → out of plane'}
        </p>
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full rounded-lg" style={{ backgroundColor: isDark ? '#111' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : '#e2e8f0'}` }}>
          <defs>
            {arrowMarker('arr-rw', mutedColor)}
            {arrowMarker('arr-hw', mutedColor)}
            {arrowMarker('arr-dir-s', '#f59e0b')}
          </defs>
          {gridLines(svgW, svgH)}
          <line x1={10} y1={svgH - 15} x2={65} y2={svgH - 15} stroke={mutedColor} strokeWidth={1.5} markerEnd="url(#arr-rw)" />
          <text x={70} y={svgH - 11} fill={mutedColor} fontSize={10} fontWeight={600}>
            {isDE ? 'Rechtswert' : 'Easting'}
          </text>
          <line x1={10} y1={svgH - 15} x2={10} y2={svgH - 70} stroke={mutedColor} strokeWidth={1.5} markerEnd="url(#arr-hw)" />
          <text x={10} y={svgH - 75} fill={mutedColor} fontSize={10} fontWeight={600} textAnchor="start" transform={`rotate(-90, 10, ${svgH - 75})`}>
            {isDE ? 'Hochwert' : 'Northing'}
          </text>
          {renderDirectionFromP3(surveyAB, mapSurvey, 'arr-dir-s')}
          {renderCrosshair(mapSurvey, surveyAB)}
          {renderPoints(surveyAB, mapSurvey)}
        </svg>
      </div>

      {/* MX9 coordinate system */}
      <div>
        <h4 className="text-sm font-semibold mb-2" style={{ color: textColor }}>
          {isDE ? 'Ergebnis: MX9 Systemkoordinaten' : 'Result: MX9 Body Coordinates'}
        </h4>
        <p className="text-xs mb-2" style={{ color: mutedColor }}>
          {isDE
            ? 'X (Fahrtrichtung) → oben, Y (+rechts) → rechts, Z (+unten) → aus Bildebene'
            : 'X (travel dir.) → up, Y (+right) → right, Z (+down) → out of plane'}
        </p>
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full rounded-lg" style={{ backgroundColor: isDark ? '#111' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : '#e2e8f0'}` }}>
          <defs>
            {arrowMarker('arr-mx', '#3b82f6')}
            {arrowMarker('arr-my', '#3b82f6')}
            {arrowMarker('arr-dir-m', '#f59e0b')}
          </defs>
          {gridLines(svgW, svgH)}
          <line x1={10} y1={svgH - 15} x2={65} y2={svgH - 15} stroke="#3b82f6" strokeWidth={1.5} markerEnd="url(#arr-my)" />
          <text x={70} y={svgH - 11} fill="#3b82f6" fontSize={10} fontWeight={600}>
            Y (+{isDE ? 'rechts' : 'right'})
          </text>
          <line x1={10} y1={svgH - 15} x2={10} y2={svgH - 70} stroke="#3b82f6" strokeWidth={1.5} markerEnd="url(#arr-mx)" />
          <text x={10} y={svgH - 75} fill="#3b82f6" fontSize={10} fontWeight={600} textAnchor="start" transform={`rotate(-90, 10, ${svgH - 75})`}>
            X ({isDE ? 'Fahrt' : 'fwd'})
          </text>
          {renderDirectionFromP3(mx9AB, mapMX9, 'arr-dir-m')}
          {renderCrosshair(mapMX9, mx9AB)}
          {renderPoints(mx9AB, mapMX9)}
        </svg>
      </div>

      {/* MX9 side view (X forward / Z down) */}
      <div>
        <h4 className="text-sm font-semibold mb-2" style={{ color: textColor }}>
          {isDE ? 'Seitenansicht: MX9 Systemkoordinaten' : 'Side View: MX9 Body Coordinates'}
        </h4>
        <p className="text-xs mb-2" style={{ color: mutedColor }}>
          {isDE
            ? 'X (Fahrtrichtung) → rechts, Z (+unten) → unten'
            : 'X (travel dir.) → right, Z (+down) → down'}
        </p>
        {(() => {
          // Side view: horizontal = X (forward), vertical = Z (positive down → SVG down)
          // finalPts Z is pre-inversion, MX9 Z = -finalPts.z
          const sideAB = finalPts.map(p => ({ a: p.x, b: p.z })) // a=X, b=MX9-Z (positive down → SVG down)
          const sideVisible = visibleIndices.map(i => sideAB[i])
          const mapSide = fitPoints(sideVisible, svgW, svgH, pad)

          return (
            <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full rounded-lg" style={{ backgroundColor: isDark ? '#111' : '#f8fafc', border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : '#e2e8f0'}` }}>
              <defs>
                {arrowMarker('arr-sx', '#3b82f6')}
                {arrowMarker('arr-sz', '#3b82f6')}
                {arrowMarker('arr-dir-side', '#f59e0b')}
              </defs>
              {gridLines(svgW, svgH)}

              {/* Axis: X (forward) → right, top-left */}
              <line x1={10} y1={15} x2={65} y2={15} stroke="#3b82f6" strokeWidth={1.5} markerEnd="url(#arr-sx)" />
              <text x={70} y={19} fill="#3b82f6" fontSize={10} fontWeight={600}>
                X ({isDE ? 'Fahrt' : 'fwd'})
              </text>

              {/* Axis: Z (+down) → downward, top-left */}
              <line x1={10} y1={15} x2={10} y2={70} stroke="#3b82f6" strokeWidth={1.5} markerEnd="url(#arr-sz)" />
              <text x={10} y={75} fill="#3b82f6" fontSize={10} fontWeight={600} textAnchor="start" transform={`rotate(90, 10, 75)`}>
                Z (+{isDE ? 'unten' : 'down'})
              </text>

              {/* Direction arrow from P3 along X axis */}
              {(() => {
                const p3 = mapSide(sideAB[2].a, sideAB[2].b)
                // Direction in side view is purely along X (horizontal right)
                const dx = sideAB[1].a - sideAB[0].a
                const len = Math.abs(dx)
                if (len < 0.0001) return null
                const dir = dx > 0 ? 1 : -1
                const arrowLen = 40
                return (
                  <g>
                    <line
                      x1={p3.sx} y1={p3.sy} x2={p3.sx + dir * arrowLen} y2={p3.sy}
                      stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3"
                      markerEnd="url(#arr-dir-side)" opacity={0.7}
                    />
                  </g>
                )
              })()}

              {/* Origin crosshair (P3) */}
              {(() => {
                const { sx, sy } = mapSide(sideAB[2].a, sideAB[2].b)
                return (
                  <>
                    <line x1={sx - 10} y1={sy} x2={sx + 10} y2={sy} stroke="#22c55e" strokeWidth={1} opacity={0.5} />
                    <line x1={sx} y1={sy - 10} x2={sx} y2={sy + 10} stroke="#22c55e" strokeWidth={1} opacity={0.5} />
                  </>
                )
              })()}

              {/* Points */}
              {visibleIndices.map(i => {
                const { sx, sy } = mapSide(sideAB[i].a, sideAB[i].b)
                const label = isDE ? VIS_LABELS_DE[i] : VIS_LABELS_EN[i]
                return (
                  <g key={i}>
                    <circle cx={sx} cy={sy} r={i === 2 ? 7 : 5} fill={POINT_COLORS[i]} opacity={0.9} />
                    <text x={sx} y={sy - 10} fill={textColor} fontSize={10} fontWeight={600} textAnchor="middle">
                      {label}
                    </text>
                  </g>
                )
              })}
            </svg>
          )
        })()}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs" style={{ color: textColor }}>
        {visibleIndices.map(i => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: POINT_COLORS[i] }} />
            <span>{isDE ? VIS_LABELS_DE[i] : VIS_LABELS_EN[i]}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5" style={{ backgroundColor: '#f59e0b' }} />
          <span>{isDE ? 'Fahrtrichtung' : 'Travel dir.'}</span>
        </div>
      </div>
    </div>
  )
}

// ── Input with inline unit suffix ──

function InputWithUnit({ label, unit, value, onChange, autoFocus }: {
  label: string
  unit: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
}) {
  return (
    <div className="w-full">
      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
        {label}
      </label>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0.0000"
          autoFocus={autoFocus}
          className="w-full px-3 py-2 pr-8 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          style={{
            backgroundColor: 'var(--color-bg-input)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border-input)',
          }}
        />
        <span
          className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--color-text-muted)', fontSize: '0.81rem' }}
        >
          {unit}
        </span>
      </div>
    </div>
  )
}

// ── Image Gallery ──

// Bilder werden automatisch aus den Ordnern geladen (Vite import.meta.glob)
const worldImageModules = import.meta.glob('/public/images/mx9-calibration/world/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' })
const mx9ImageModules = import.meta.glob('/public/images/mx9-calibration/mx9/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' })

const WORLD_IMAGES: string[] = Object.values(worldImageModules) as string[]
const MX9_IMAGES: string[] = Object.values(mx9ImageModules) as string[]

function ImageGallery({ images, isDE, isDark, onClose }: {
  images: string[]
  isDE: boolean
  isDark: boolean
  onClose: () => void
}) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [zoomed, setZoomed] = useState(false)

  if (images.length === 0) {
    return (
      <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}>
        <div className="text-center p-8">
          <p className="text-white text-lg mb-4">
            {isDE ? 'Noch keine Bilder vorhanden' : 'No images available yet'}
          </p>
          <Button onClick={onClose}>
            {isDE ? 'Schließen' : 'Close'}
          </Button>
        </div>
      </div>
    )
  }

  const prev = () => { setCurrentIndex(i => Math.max(0, i - 1)); setZoomed(false) }
  const next = () => { setCurrentIndex(i => Math.min(images.length - 1, i + 1)); setZoomed(false) }

  return (
    <div className="fixed inset-0 z-[10000] flex flex-col" style={{ backgroundColor: 'rgba(0,0,0,0.95)' }}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 flex-shrink-0">
        <span className="text-white text-sm">{currentIndex + 1} / {images.length}</span>
        <button onClick={onClose} className="p-2 rounded-full" style={{ color: 'white' }}>
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Image area */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden px-2">
        {images.length > 1 && currentIndex > 0 && (
          <button onClick={prev} className="absolute left-1 z-10 p-2 rounded-full bg-black/50 text-white">
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        <div
          className="w-full h-full flex items-center justify-center"
          onClick={() => setZoomed(z => !z)}
          style={{ cursor: zoomed ? 'zoom-out' : 'zoom-in' }}
        >
          <img
            src={images[currentIndex]}
            alt={`${currentIndex + 1}`}
            className="transition-transform duration-200"
            style={{
              maxWidth: zoomed ? '200%' : '100%',
              maxHeight: zoomed ? 'none' : '100%',
              objectFit: 'contain',
              transform: zoomed ? 'scale(2)' : 'scale(1)',
            }}
            draggable={false}
          />
        </div>

        {images.length > 1 && currentIndex < images.length - 1 && (
          <button onClick={next} className="absolute right-1 z-10 p-2 rounded-full bg-black/50 text-white">
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Dots */}
      {images.length > 1 && (
        <div className="flex justify-center gap-2 p-3 flex-shrink-0">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => { setCurrentIndex(i); setZoomed(false) }}
              className="w-2 h-2 rounded-full transition-colors"
              style={{ backgroundColor: i === currentIndex ? '#3b82f6' : 'rgba(255,255,255,0.3)' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ──

export function MX9Calibration() {
  const { i18n } = useTranslation()
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const isDE = i18n.language === 'de'
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [points, setPoints] = useState<Point3D[]>(
    Array.from({ length: 5 }, () => ({ x: '', y: '', z: '' }))
  )
  const [computeResult, setComputeResult] = useState<ComputeResult | null>(null)
  const [error, setError] = useState(false)
  const [importError, setImportError] = useState(false)
  const [showVisualization, setShowVisualization] = useState(false)
  const [phaseOffset, setPhaseOffset] = useState('8.89')
  const [showPhaseConfirm, setShowPhaseConfirm] = useState(false)
  const [pendingPhaseOffset, setPendingPhaseOffset] = useState('')
  const [showWorldGallery, setShowWorldGallery] = useState(false)
  const [showMX9Gallery, setShowMX9Gallery] = useState(false)

  const result = computeResult?.result ?? null

  const updatePoint = (index: number, axis: 'x' | 'y' | 'z', value: string) => {
    setPoints(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [axis]: value }
      return next
    })
  }

  const handleCalculateClick = () => {
    setPendingPhaseOffset(phaseOffset)
    setShowPhaseConfirm(true)
  }

  const handleConfirmCalculate = () => {
    setPhaseOffset(pendingPhaseOffset)
    setShowPhaseConfirm(false)
    const offsetM = parseNum(pendingPhaseOffset) / 100 // cm → m
    const res = compute(points, isNaN(offsetM) ? 0 : offsetM)
    if (res) {
      setComputeResult(res)
      setError(false)
    } else {
      setComputeResult(null)
      setError(true)
    }
  }

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = parseCSV(text)
      if (parsed) {
        setPoints(parsed)
        setImportError(false)
        setComputeResult(null)
      } else {
        setImportError(true)
      }
    } catch {
      setImportError(true)
    }

    e.target.value = ''
  }

  const allFilled = points.every(p => p.x.trim() && p.y.trim() && p.z.trim())

  return (
    <div className="space-y-4">
      {/* Info Box */}
      <div
        className="flex items-start gap-2 p-3 rounded-lg"
        style={{
          border: '1px solid rgba(59, 130, 246, 0.5)',
          backgroundColor: isDark ? 'transparent' : 'rgba(59, 130, 246, 0.1)',
        }}
      >
        <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm" style={{ color: 'var(--color-text)' }}>
          {isDE
            ? 'Geben Sie die 5 mit dem Tachymeter gemessenen 3D-Punkte ein oder importieren Sie eine CSV/TXT-Datei. Punkt 1 nach Punkt 2 definiert die Fahrtrichtung (Richtungsvektor des MX9), Punkt 3 ist der MX9-Referenzpunkt, Punkt 4 der DMI-Messpunkt auf der Straße/Schiene und Punkt 5 die Unterkante der GAMS-Antenne. Der Phasenoffset kann zusätzlich eingegeben werden ist aber standardmäßig auf den Offset der Trimble GA830 Antenne eingestellt. Vor dem Berechnen bekommt der Nutzer eine zusätzliche Meldung zum Phasenzentrum angezeigt bevor die MX9-Hebelarme berechnet werden.'
            : 'Enter the 5 3D points measured with the total station or import a CSV/TXT file. Point 1 to Point 2 defines the travel direction (MX9 direction vector), Point 3 is the MX9 reference point, Point 4 the DMI measurement point on the road/rail, and Point 5 the bottom of the GAMS antenna. The phase offset can be entered additionally but defaults to the Trimble GA830 antenna offset. Before calculating, the user receives an additional prompt about the phase center before the MX9 lever arms are computed.'}
        </p>
      </div>

      {/* File Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt"
        onChange={handleFileImport}
        className="hidden"
      />
      <Button
        onClick={() => fileInputRef.current?.click()}
        className="w-full"
      >
        <Upload className="w-4 h-4 mr-2" />
        {isDE ? 'CSV/TXT importieren' : 'Import CSV/TXT'}
      </Button>
      {importError && (
        <p className="text-sm text-red-500 text-center">
          {isDE
            ? 'Datei konnte nicht gelesen werden. Format: Punktnummer,X,Y,Z (5 Zeilen)'
            : 'Could not read file. Format: PointNumber,X,Y,Z (5 lines)'}
        </p>
      )}

      {/* Weltkoordinatensystem Group */}
      <div
        className="rounded-xl p-3 space-y-3"
        style={{ border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {isDE ? 'Weltkoordinatensystem' : 'World Coordinate System'}
          </h3>
          <button
            onClick={() => setShowWorldGallery(true)}
            className="p-1.5 rounded-lg"
            style={{ color: isDark ? '#3b82f6' : '#2563eb' }}
          >
            <Image className="w-5 h-5" />
          </button>
        </div>
        {points.map((point, index) => (
          <Card key={index}>
            <CardContent>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
                {isDE ? POINT_LABELS[index].de : POINT_LABELS[index].en}
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <InputWithUnit label="X" unit="m" value={point.x} onChange={v => updatePoint(index, 'x', v)} />
                <InputWithUnit label="Y" unit="m" value={point.y} onChange={v => updatePoint(index, 'y', v)} />
                <InputWithUnit label="Z" unit="m" value={point.z} onChange={v => updatePoint(index, 'z', v)} />
              </div>
            </CardContent>
          </Card>
        ))}

        {/* GAMS Phase Center Offset */}
        <Card>
          <CardContent>
            <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
              {isDE ? 'GAMS Phasenzentrum-Offset' : 'GAMS Phase Center Offset'}
            </h3>
            <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
              {isDE
                ? 'Differenz Antennen-Unterkante zum Phasenzentrum. Standard: Trimble GA830 = 8,89 cm. Auf 0 setzen falls bereits in der Messung berücksichtigt.'
                : 'Difference from antenna bottom to phase center. Default: Trimble GA830 = 8.89 cm. Set to 0 if already accounted for in measurement.'}
            </p>
            <div className="w-32">
              <InputWithUnit label="Offset" unit="cm" value={phaseOffset} onChange={setPhaseOffset} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Calculate Button */}
      <Button
        onClick={handleCalculateClick}
        className="w-full"
        disabled={!allFilled}
        style={allFilled ? (isDark
          ? { backgroundColor: 'transparent', color: '#22c55e', border: '2px solid #22c55e' }
          : { backgroundColor: '#16a34a', color: 'white', border: '2px solid #16a34a' }
        ) : undefined}
      >
        <Calculator className="w-4 h-4 mr-2" />
        {isDE ? 'Berechnen' : 'Calculate'}
      </Button>

      {error && (
        <p className="text-sm text-red-500 text-center">
          {isDE
            ? 'Ungültige Eingabe. Bitte alle Felder mit gültigen Zahlen füllen.'
            : 'Invalid input. Please fill all fields with valid numbers.'}
        </p>
      )}

      {/* MX9-Hebelarme Group */}
      {result && (
        <div
          className="rounded-xl p-3 space-y-3"
          style={{ border: '1px solid #3b82f6' }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold" style={{ color: '#3b82f6' }}>
              {isDE ? 'MX9-Hebelarme' : 'MX9 Lever Arms'}
            </h3>
            <button
              onClick={() => setShowMX9Gallery(true)}
              className="p-1.5 rounded-lg"
              style={{ color: '#3b82f6' }}
            >
              <Image className="w-5 h-5" />
            </button>
          </div>

          {/* DMI */}
          <Card>
            <CardContent>
              <h3 className="text-sm font-semibold mb-2" style={{ color: '#3b82f6' }}>
                DMI (Punkt 4)
              </h3>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>X</span>
                  <p className="font-mono font-medium" style={{ color: 'var(--color-text)' }}>
                    {formatValue(result.dmi.x)}
                  </p>
                </div>
                <div>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Y</span>
                  <p className="font-mono font-medium" style={{ color: 'var(--color-text)' }}>
                    {formatValue(result.dmi.y)}
                  </p>
                </div>
                <div>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Z</span>
                  <p className="font-mono font-medium" style={{ color: 'var(--color-text)' }}>
                    {formatValue(result.dmi.z)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* GAMS */}
          <Card>
            <CardContent>
              <h3 className="text-sm font-semibold mb-2" style={{ color: '#3b82f6' }}>
                GAMS (Punkt 5)
              </h3>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>X</span>
                  <p className="font-mono font-medium" style={{ color: 'var(--color-text)' }}>
                    {formatValue(result.gams.x)}
                  </p>
                </div>
                <div>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Y</span>
                  <p className="font-mono font-medium" style={{ color: 'var(--color-text)' }}>
                    {formatValue(result.gams.y)}
                  </p>
                </div>
                <div>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Z</span>
                  <p className="font-mono font-medium" style={{ color: 'var(--color-text)' }}>
                    {formatValue(result.gams.z)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Aufbauhöhe = DMI Z */}
          <Card>
            <CardContent>
              <h3 className="text-sm font-semibold mb-2" style={{ color: '#3b82f6' }}>
                {isDE ? 'Aufbauhöhe' : 'Body Height'}
              </h3>
              <div className="text-sm">
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Z</span>
                <p className="font-mono font-medium" style={{ color: 'var(--color-text)' }}>
                  {formatValue(result.dmi.z)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Visualization Button */}
          <Button
            variant="secondary"
            onClick={() => setShowVisualization(true)}
            className="w-full"
          >
            <Eye className="w-4 h-4 mr-2" />
            {isDE ? 'Darstellung anzeigen' : 'Show Visualization'}
          </Button>
        </div>
      )}

      {/* Phase Offset Confirmation Modal */}
      {showPhaseConfirm && (
        <Modal
          isOpen={showPhaseConfirm}
          onClose={() => setShowPhaseConfirm(false)}
          title={isDE ? 'Phasenzentrum-Offset prüfen' : 'Check Phase Center Offset'}
        >
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              {isDE
                ? 'Bitte prüfen Sie den GAMS-Phasenzentrum-Offset. Der Offset wird auf die Z-Höhe der GAMS-Antenne (Punkt 5) aufaddiert.'
                : 'Please verify the GAMS phase center offset. The offset is added to the Z height of the GAMS antenna (Point 5).'}
            </p>
            <div
              className="p-3 rounded-lg text-sm space-y-2"
              style={{
                backgroundColor: isDark ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.05)',
                border: '1px solid rgba(245,158,11,0.4)',
                color: 'var(--color-text)',
              }}
            >
              <p>
                {isDE
                  ? '• Trimble GA830 (Standard): 8,89 cm'
                  : '• Trimble GA830 (default): 8.89 cm'}
              </p>
              <p>
                {isDE
                  ? '• Bereits in der Messung berücksichtigt: 0 cm'
                  : '• Already accounted for in measurement: 0 cm'}
              </p>
              <p>
                {isDE
                  ? '• Andere Antenne: entsprechenden Wert eingeben'
                  : '• Other antenna: enter the appropriate value'}
              </p>
            </div>
            <div className="w-40">
              <InputWithUnit label="Offset" unit="cm" value={pendingPhaseOffset} onChange={setPendingPhaseOffset} autoFocus />
            </div>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowPhaseConfirm(false)}
                className="flex-1"
              >
                {isDE ? 'Abbrechen' : 'Cancel'}
              </Button>
              <Button
                onClick={handleConfirmCalculate}
                className="flex-1"
              >
                <Calculator className="w-4 h-4 mr-2" />
                {isDE ? 'Berechnen' : 'Calculate'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Visualization Modal */}
      {showVisualization && computeResult && (
        <Modal
          isOpen={showVisualization}
          onClose={() => setShowVisualization(false)}
          title={isDE ? 'Koordinaten-Transformation' : 'Coordinate Transformation'}
          size="lg"
        >
          <div className="max-h-[70vh] overflow-y-auto">
            <CoordinateVisualization
              inputPts={computeResult.inputPts}
              finalPts={computeResult.finalPts}
              isDark={isDark}
              isDE={isDE}
            />
          </div>
        </Modal>
      )}

      {/* Image Galleries */}
      {showWorldGallery && (
        <ImageGallery images={WORLD_IMAGES} isDE={isDE} isDark={isDark} onClose={() => setShowWorldGallery(false)} />
      )}
      {showMX9Gallery && (
        <ImageGallery images={MX9_IMAGES} isDE={isDE} isDark={isDark} onClose={() => setShowMX9Gallery(false)} />
      )}
    </div>
  )
}
