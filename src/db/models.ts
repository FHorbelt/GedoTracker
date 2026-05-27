// Database Models / Interfaces

// === FIXED LISTS (im Code gepflegt) ===

// Trolley Seriennummern (fest im Code)
export const TROLLEY_SERIAL_NUMBERS = ['Trolley 1', 'Trolley 2'] as const
export type TrolleySerialNumber = typeof TROLLEY_SERIAL_NUMBERS[number]

// Scanner Seriennummern (fest im Code)
export const SCANNER_SERIAL_NUMBERS = ['Scanner 1', 'Scanner 2'] as const
export type ScannerSerialNumber = typeof SCANNER_SERIAL_NUMBERS[number]

// Gleisarten für Dropdown
export const TRACK_TYPES = ['RIG', 'GRIG', 'Bf-Gleis', 'WV', 'unbekannt'] as const
export type TrackType = typeof TRACK_TYPES[number]

// === EXISTING TYPES ===

export type ScannerType = 'GX50' | 'TX8'
export type ScannerOrientation = '80°' | '90°'
export type ScannerAlignment = '90°/90°' | '80°/80°'
export type WeatherCondition = 'sunny' | 'cloudy' | 'rainy'
export type Environment = 'outdoor' | 'covered'
export type Direction = 'ascending' | 'descending'
export type TrackingMode = 'single' | 'double'
export type TrackSide = 'all' | 'left' | 'right'

// Weather data
export interface Weather {
  condition: WeatherCondition
  environment: Environment
}

// Fixed Point (Festpunkt) - WGS84 Koordinaten
export interface FixedPoint {
  id: string
  pointNumber: string      // Punktnummer
  longitude: number        // Längengrad (WGS84)
  latitude: number         // Breitengrad (WGS84)
  elevation: number        // Höhe (m)
  type: string             // Art (Code aus KML, z.B. "112", "20")
}

// Bounding Box for tile caching
export interface BoundingBox {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

// Tile cache info for offline maps
export interface TileCacheInfo {
  bbox: BoundingBox
  tileCount: number
  cachedAt: number
}

// Fixed Point Field (Festpunktfeld)
export interface FixedPointField {
  id: string
  name: string
  points: FixedPoint[]
  tileCacheInfo?: TileCacheInfo  // Optional offline tile cache info
  createdAt: string
  updatedAt: string
}

// Map Tile for offline caching
export interface MapTile {
  id: string           // fieldId/z/x/y
  fieldId: string      // Reference to FixedPointField
  z: number            // Zoom level
  x: number            // Tile X coordinate
  y: number            // Tile Y coordinate
  blob: Blob           // Tile image data
  timestamp: number    // When cached
}

// Target Board Info (Zieltafel-Informationen)
export interface TargetBoardInfo {
  size: string             // Seitenlänge z.B. "100" oder "200" (in mm)
  height: number           // Zielhöhe in mm (z.B. -6, 0, +6)
  thickness: number        // Tafeldicke in mm (z.B. 50, 60, 70)
}

// Tracked Point during a run
export interface TrackedPoint {
  id: string
  pointId?: string         // Reference to FixedPoint (optional if manual)
  pointNumber: string      // Point number (from field or manual)
  side: 'left' | 'right'   // Side of track
  localDistance: number    // Distance from run start (m)
  kmValue: number          // KM value at this point (calculated)
  timestamp: string        // When was this point recorded
  targetBoardId?: string   // Reference to TargetBoard configuration (legacy)
  targetBoard?: TargetBoardInfo  // Target board settings for this point
  remark?: string          // Bemerkung am Punkt (NEU)
  gpsPosition?: {          // GPS position when point was captured
    latitude: number
    longitude: number
    accuracy?: number
  }
}

// Remark during a run
export interface RunRemark {
  id: string
  number: number           // Sequential number (1, 2, 3...)
  text: string
  timestamp: string
  kmValue?: number         // Optional KM where remark was made
}

// Target Board (Zieltafel) configuration
export interface TargetBoard {
  id: string
  name: string             // Display name, e.g., "100mm / 200mm / 3mm"
  sideLength: number       // Seitenlänge in mm (100, 200, etc.)
  boardHeight: number      // Tafelhöhe in mm (-6, 200, 500, etc.)
  boardThickness: number   // Tafeldicke in mm (0, 3, 60, etc.)
  isCustom: boolean        // User-defined or standard
  createdAt: string
}

// GPS Waypoint for track recording
export interface GpsWaypoint {
  latitude: number
  longitude: number
  altitude?: number
  timestamp: string
  accuracy?: number
  type: 'start' | 'end' | 'waypoint' | 'point'  // Type of waypoint
  pointNumber?: string     // Associated point number (for 'point' type)
  localDistance?: number   // Distance at this waypoint
}

// Measurement Run (Messfahrt)
export interface MeasurementRun {
  id: string
  projectId: string        // Referenz zum Projekt (für Migration/Kompatibilität)
  measurementJobId: string // Referenz zum Messjob (NEU - Pflicht)
  runNumber: number
  runName: string          // e.g., "A252_Auf_Scan 01"

  // Strecken-/Gleisdaten (überarbeitet)
  routeNumber: string      // Streckennummer (NEU - war "track")
  trackType: TrackType     // Gleisart: RIG, GRIG, Bf-Gleis, WV, unbekannt (NEU)
  direction: Direction
  objectDesignation?: string // Optional für Anmerkungen (jetzt optional)

  startKm: number          // Start KM in meters
  endKm?: number           // End KM in meters (calculated)
  length?: number          // Total length in m

  // Scanner-Einstellungen (vom Messjob vererbt, aber editierbar)
  scannerSerialNumber?: ScannerSerialNumber  // NEU
  scannerType: ScannerType                   // NEU (war nicht in Run)
  scannerAlignment: ScannerAlignment
  withTower?: boolean                        // NEU
  towerHeight?: number                       // NEU

  speed?: number           // m/s (Standard: 0.8)
  trackingMode: TrackingMode
  pointNumberFrom?: string // First point (auto-filled)
  pointNumberTo?: string   // Last point (auto-filled)
  trackedPoints: TrackedPoint[]
  remarks: RunRemark[]     // Numbered remarks
  gpsEnabled: boolean      // Erstmal ausgegraut (nicht funktional)
  gpsTrack?: GpsPoint[]    // Optional GPS track (legacy)
  gpsWaypoints?: GpsWaypoint[]  // GPS waypoints including start, end, and timed waypoints

  // Solltrasse (Reference Trajectory) für GPS-Snapping
  referenceTrajectoryId?: string

  // Startposition auf der Trajektorie (für Punktvorschläge)
  startPositionSnap?: {
    latitude: number
    longitude: number
    bearing: number
    distanceAlongSpline: number
  }

  isCompleted: boolean     // Is the run finished?
  createdAt: string
  updatedAt: string
}

// GPS Point (for optional GPS tracking)
export interface GpsPoint {
  latitude: number
  longitude: number
  timestamp: string
  accuracy?: number
}

// Trajectory Point for reference trajectories (Solltrassen)
export interface TrajectoryPoint {
  lon: number
  lat: number
  elevation?: number
}

// Reference Trajectory (Solltrasse) loaded from KML LineStrings
export interface ReferenceTrajectory {
  id: string
  name: string                    // Name from KML <Placemark><name> or <Folder><name>
  points: TrajectoryPoint[]       // Flat point array (legacy / spline input)
  segments?: TrajectoryPoint[][]  // Connected sub-polylines (multi-polyline rendering)
  fixedPointFieldId?: string      // Optional link to FixedPointField (imported together from same KML)
  createdAt: string
  updatedAt: string
}

// Dragged Trajectory Point for manual trajectory adjustment
export interface DraggedTrajectoryPoint {
  index: number                  // Index des Punktes auf der Trajektorie (0, 1, 2, ...)
  originalLat: number            // Ursprüngliche Latitude
  originalLon: number            // Ursprüngliche Longitude
  adjustedLat: number            // Angepasste Latitude nach Drag
  adjustedLon: number            // Angepasste Longitude nach Drag
}

// Measurement Job (Messjob) - NEU
export interface MeasurementJob {
  id: string
  projectId: string        // Referenz zum Projekt
  jobName: string          // Pflicht
  jobDate: string          // Pflicht - Datum des Messjobs

  // Optionale Felder
  object?: string          // Objekt (optional, kann vom Projekt abweichen)

  // Trolley & Scanner (feste Auswahllisten)
  trolleySerialNumber?: TrolleySerialNumber
  scannerSerialNumber?: ScannerSerialNumber

  // Scanner-Einstellungen
  scannerType: ScannerType        // Pflicht
  scannerAlignment?: ScannerAlignment
  withTower?: boolean
  towerHeight?: number            // in mm

  // Mitarbeiter (Referenzen zu globaler Liste)
  employeeIds: string[]

  // Wetterbedingungen
  weather: Weather                // Pflicht

  // Festpunktfeld
  fixedPointFieldId?: string      // Reference to FixedPointField

  // Trajektorie-Einstellungen (NEU)
  trajectorySettings?: {
    stationTolerance: number      // Stations-Toleranz in Metern (default: 25)
    smoothingPasses: number       // Glättungs-Durchläufe (default: 0)
    trackSide: TrackSide          // Gleisseite: all, left, right (default: 'all')
    isReversed: boolean           // Fahrtrichtung umgekehrt (default: false)
    // Ziehbare Punkte für manuelle Trajektorie-Anpassung
    draggedPoints?: DraggedTrajectoryPoint[]
    dragPointSpacing?: number     // Abstand zwischen Ziehpunkten in Metern (default: 50)
  }

  createdAt: string
  updatedAt: string
}

// Project (vereinfacht - Scanner/Wetter/Mitarbeiter/Objekt sind jetzt im Messjob)
export interface Project {
  id: string
  projectNumber: string           // Pflicht
  client?: string                 // Auftraggeber (optional)
  constructionProject?: string    // Bauvorhaben (optional)
  startDate: string               // Umbenannt von "date" zu "startDate"

  // Firma / Logo
  logoId?: string                 // Reference to CompanyLogo (Firmenauswahl)

  // Diese Felder wurden in den Messjob verschoben:
  // - object (Objekt)
  // - scannerType, scannerOrientation, withTower, towerHeight
  // - employees
  // - weather
  // - fixedPointFieldId

  createdAt: string
  updatedAt: string
}

// Employee (for the employee list)
export interface Employee {
  id: string
  name: string
  company?: string      // Firma (optional)
  location?: string     // Standort (optional)
  createdAt: string
}

// Company Logo
export interface CompanyLogo {
  id: string
  name: string           // Company name (e.g., "Firma A")
  imageData: string      // Base64 encoded image
  mimeType: string       // e.g., "image/png", "image/jpeg"
  isDefault: boolean     // Is this the default logo?
  createdAt: string
}

// App Settings
export interface AppSettings {
  id: string
  language: 'de' | 'en'
  theme?: 'light' | 'dark'
  lastBackup?: string
  compactView?: boolean // Minimizes project/job info cards for field work
  betaSplineEnabled?: boolean // Enables spline trajectory beta feature
}

// Backup structure
export interface BackupData {
  version: string
  createdAt: string
  projects: Project[]
  measurementJobs: MeasurementJob[]
  runs: MeasurementRun[]
  fixedPointFields: FixedPointField[]
  referenceTrajectories: ReferenceTrajectory[]
  employees: Employee[]
  logos: CompanyLogo[]
  settings: AppSettings
}

// Project export structure (for sharing)
export interface ProjectExport {
  version: string
  createdAt: string
  project: Project
  measurementJobs: MeasurementJob[]  // NEU
  runs: MeasurementRun[]
  fixedPointFields?: FixedPointField[]  // Kann mehrere sein (pro Job)
}
