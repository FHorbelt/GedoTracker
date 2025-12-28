// Database Models / Interfaces

export type ScannerType = 'GX50' | 'TX8'
export type ScannerOrientation = '80°' | '90°'
export type ScannerAlignment = '90°/90°' | '80°/80°'
export type WeatherCondition = 'sunny' | 'cloudy' | 'rainy'
export type Environment = 'outdoor' | 'covered'
export type Direction = 'ascending' | 'descending'
export type TrackingMode = 'single' | 'double'

// Weather data
export interface Weather {
  condition: WeatherCondition
  environment: Environment
}

// Fixed Point (Festpunkt)
export interface FixedPoint {
  id: string
  pointNumber: string      // Punktnummer
  easting: number          // Rechtswert
  northing: number         // Hochwert
  elevation: number        // Höhe
  type: string             // Art (GVPV, PS0, PS1, etc.)
}

// Fixed Point Field (Festpunktfeld)
export interface FixedPointField {
  id: string
  name: string
  points: FixedPoint[]
  createdAt: string
  updatedAt: string
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
  projectId: string
  runNumber: number
  runName: string          // e.g., "A252_Auf_Scan 01"
  track: string            // Gleis
  direction: Direction
  objectDesignation: string // Strecke, BhfGleis
  startKm: number          // Start KM in meters
  endKm?: number           // End KM in meters (calculated)
  length?: number          // Total length in m
  scannerAlignment: ScannerAlignment
  speed?: number           // m/s
  trackingMode: TrackingMode
  pointNumberFrom?: string // First point (auto-filled)
  pointNumberTo?: string   // Last point (auto-filled)
  trackedPoints: TrackedPoint[]
  remarks: RunRemark[]     // Numbered remarks
  gpsEnabled: boolean
  gpsTrack?: GpsPoint[]    // Optional GPS track (legacy)
  gpsWaypoints?: GpsWaypoint[]  // GPS waypoints including start, end, and timed waypoints
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

// Project
export interface Project {
  id: string
  projectNumber: string
  client: string           // Auftraggeber
  constructionProject: string // Bauvorhaben
  object: string           // Objekt
  date: string
  scannerType: ScannerType
  scannerOrientation: ScannerAlignment
  withTower: boolean
  towerHeight?: number     // in mm
  employees: string[]
  weather: Weather
  fixedPointFieldId?: string // Reference to FixedPointField
  createdAt: string
  updatedAt: string
}

// Employee (for the employee list)
export interface Employee {
  id: string
  name: string
  createdAt: string
}

// App Settings
export interface AppSettings {
  id: string
  language: 'de' | 'en'
  lastBackup?: string
}

// Backup structure
export interface BackupData {
  version: string
  createdAt: string
  projects: Project[]
  runs: MeasurementRun[]
  fixedPointFields: FixedPointField[]
  employees: Employee[]
  settings: AppSettings
}

// Project export structure (for sharing)
export interface ProjectExport {
  version: string
  createdAt: string
  project: Project
  runs: MeasurementRun[]
  fixedPointField?: FixedPointField
}
