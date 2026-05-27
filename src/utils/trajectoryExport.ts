import { MeasurementRun, GpsPoint, ReferenceTrajectory } from '../db/models'
import { buildSplineFromTrajectoryPoints, snapToSpline } from './pointSuggestion'
import { smoothGpsTrackBatch } from './gpsFilter'

// Predefined colors for different runs (KML uses AABBGGRR format)
const RUN_COLORS = [
  'ff0000ff', // Red
  'ff00ff00', // Green
  'ffff0000', // Blue
  'ff00ffff', // Yellow
  'ffff00ff', // Magenta
  'ffffff00', // Cyan
  'ff0080ff', // Orange
  'ff8000ff', // Pink
  'ff00ff80', // Lime
  'ff80ff00', // Light Blue
]

/**
 * Snap GPS points onto a reference trajectory spline.
 * Returns snapped GpsPoints (position projected onto the trajectory).
 */
function snapGpsTrackToTrajectory(
  gpsTrack: GpsPoint[],
  trajectory: ReferenceTrajectory
): GpsPoint[] {
  const spline = buildSplineFromTrajectoryPoints(trajectory.points)
  if (!spline) return gpsTrack

  return gpsTrack.map(p => {
    const result = snapToSpline(spline, { latitude: p.latitude, longitude: p.longitude })
    return {
      latitude: result.position.latitude,
      longitude: result.position.longitude,
      timestamp: p.timestamp,
      accuracy: p.accuracy
    }
  })
}

/**
 * Export a single run's GPS trajectory to KML format.
 * If a referenceTrajectory is provided, the snapped track becomes the main (visible) track
 * and raw GPS is included as a secondary hidden layer.
 */
export function exportRunTrajectoryToKML(
  run: MeasurementRun,
  referenceTrajectory?: ReferenceTrajectory
): string {
  if (!run.gpsTrack || run.gpsTrack.length === 0) {
    throw new Error('Keine GPS-Daten vorhanden')
  }

  const rawCoordinates = formatCoordinates(run.gpsTrack)
  const timestamps = run.gpsTrack.map((p: GpsPoint) => `<when>${p.timestamp}</when>`).join('\n          ')

  const hasTrajectory = referenceTrajectory && run.referenceTrajectoryId

  // Determine the primary display track
  let mainTrack: GpsPoint[]
  let mainLabel: string
  let mainDescription: string

  if (hasTrajectory) {
    // Snapped to reference trajectory
    mainTrack = snapGpsTrackToTrajectory(run.gpsTrack, referenceTrajectory)
    mainLabel = `${run.runName} (Solltrasse)`
    mainDescription = `GPS-Track auf Solltrasse "${escapeXml(referenceTrajectory.name)}" gesnappt`
  } else {
    // Pure GNSS: smooth the stored raw track for the main display
    mainTrack = smoothGpsTrackBatch(run.gpsTrack)
    mainLabel = `${run.runName} (geglättet)`
    mainDescription = `Geglätteter GNSS-Track (Savitzky-Golay, 21-Punkt-Fenster, Grad 3)`
  }

  const mainCoordinates = formatCoordinates(mainTrack)
  // KML color: green for main track
  const mainColor = 'ff00ff00'

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>${escapeXml(run.runName)}</name>
    <description><![CDATA[
Messfahrt: ${escapeXml(run.runName)}
Strecke: ${run.routeNumber || '-'}
Gleis: ${run.trackType || '-'}
Richtung: ${run.direction === 'ascending' ? 'Aufsteigend' : 'Absteigend'}
Start-KM: ${run.startKm}
GPS-Punkte: ${run.gpsTrack.length}${hasTrajectory ? `\nSolltrasse: ${referenceTrajectory.name}\nHaupttrack: Auf Solltrasse gesnappt` : '\nModus: Reines GNSS-Tracking\nHaupttrack: Geglättet (SG-Filter)'}
    ]]></description>

    <Style id="mainTrackStyle">
      <LineStyle>
        <color>${mainColor}</color>
        <width>4</width>
      </LineStyle>
    </Style>

    <Style id="rawTrackStyle">
      <LineStyle>
        <color>ff0000ff</color>
        <width>2</width>
      </LineStyle>
    </Style>

    <!-- Main track (smoothed for pure GNSS, snapped for reference trajectory) -->
    <Placemark>
      <name>${escapeXml(mainLabel)}</name>
      <description><![CDATA[${mainDescription}]]></description>
      <styleUrl>#mainTrackStyle</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${mainCoordinates}</coordinates>
      </LineString>
    </Placemark>

    <!-- Raw GPS track with timestamps (gx:Track) – hidden by default -->
    <Placemark>
      <name>${escapeXml(run.runName)} (GPS roh)</name>
      <visibility>0</visibility>
      <styleUrl>#rawTrackStyle</styleUrl>
      <gx:Track>
        ${timestamps}
        ${run.gpsTrack.map((p: GpsPoint) => `<gx:coord>${p.longitude} ${p.latitude} 0</gx:coord>`).join('\n        ')}
      </gx:Track>
    </Placemark>

    <!-- Raw GPS LineString (hidden) -->
    <Placemark>
      <name>${escapeXml(run.runName)} (GPS Linie roh)</name>
      <visibility>0</visibility>
      <styleUrl>#rawTrackStyle</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${rawCoordinates}</coordinates>
      </LineString>
    </Placemark>

    <!-- Start marker -->
    <Placemark>
      <name>Start: ${escapeXml(run.runName)}</name>
      <description>Startpunkt der Messfahrt</description>
      <Style>
        <IconStyle>
          <color>ff00ff00</color>
          <Icon><href>http://maps.google.com/mapfiles/kml/paddle/go.png</href></Icon>
        </IconStyle>
      </Style>
      <Point>
        <coordinates>${mainTrack[0].longitude},${mainTrack[0].latitude},0</coordinates>
      </Point>
    </Placemark>

    <!-- End marker -->
    <Placemark>
      <name>Ende: ${escapeXml(run.runName)}</name>
      <description>Endpunkt der Messfahrt</description>
      <Style>
        <IconStyle>
          <color>ff0000ff</color>
          <Icon><href>http://maps.google.com/mapfiles/kml/paddle/stop.png</href></Icon>
        </IconStyle>
      </Style>
      <Point>
        <coordinates>${mainTrack[mainTrack.length - 1].longitude},${mainTrack[mainTrack.length - 1].latitude},0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`
}

/**
 * Export all runs from a project to a single KML with different colors.
 * If trajectoryMap is provided, runs with a matching referenceTrajectoryId
 * will use snapped coordinates as the main track.
 */
export function exportProjectTrajectoriesToKML(
  projectName: string,
  runs: MeasurementRun[],
  trajectoryMap?: Map<string, ReferenceTrajectory>
): string {
  const runsWithGps = runs.filter(r => r.gpsTrack && r.gpsTrack.length > 0)

  if (runsWithGps.length === 0) {
    throw new Error('Keine Messfahrten mit GPS-Daten vorhanden')
  }

  // Generate styles for each run
  const styles = runsWithGps.map((_, index) => {
    const color = RUN_COLORS[index % RUN_COLORS.length]
    return `
    <Style id="trackStyle${index}">
      <LineStyle>
        <color>${color}</color>
        <width>4</width>
      </LineStyle>
    </Style>`
  }).join('')

  // Generate placemarks for each run
  const placemarks = runsWithGps.map((run, index) => {
    const trajectory = run.referenceTrajectoryId && trajectoryMap
      ? trajectoryMap.get(run.referenceTrajectoryId)
      : undefined
    const color = RUN_COLORS[index % RUN_COLORS.length]

    let mainTrack: GpsPoint[]
    let mainLabel: string
    let modeNote: string

    if (trajectory) {
      mainTrack = snapGpsTrackToTrajectory(run.gpsTrack!, trajectory)
      mainLabel = `${run.runName} (Solltrasse)`
      modeNote = `Solltrasse: ${trajectory.name}`
    } else {
      mainTrack = smoothGpsTrackBatch(run.gpsTrack!)
      mainLabel = `${run.runName} (geglättet)`
      modeNote = 'Modus: Reines GNSS, geglättet (SG-Filter)'
    }

    const mainCoordinates = formatCoordinates(mainTrack)
    const rawCoordinates = formatCoordinates(run.gpsTrack!)

    return `
    <Folder>
      <name>${escapeXml(run.runName)}</name>
      <description><![CDATA[
Strecke: ${run.routeNumber || '-'}
Gleis: ${run.trackType || '-'}
Richtung: ${run.direction === 'ascending' ? 'Aufsteigend' : 'Absteigend'}
GPS-Punkte: ${run.gpsTrack!.length}
${modeNote}
      ]]></description>

      <!-- Main track (smoothed GNSS or snapped to trajectory) -->
      <Placemark>
        <name>${escapeXml(mainLabel)}</name>
        <styleUrl>#trackStyle${index}</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${mainCoordinates}</coordinates>
        </LineString>
      </Placemark>

      <!-- Raw GPS track (hidden) -->
      <Placemark>
        <name>${escapeXml(run.runName)} (GPS roh)</name>
        <visibility>0</visibility>
        <Style>
          <LineStyle>
            <color>${color}</color>
            <width>1</width>
          </LineStyle>
        </Style>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${rawCoordinates}</coordinates>
        </LineString>
      </Placemark>

      <Placemark>
        <name>Start: ${escapeXml(run.runName)}</name>
        <Style>
          <IconStyle>
            <color>${color}</color>
            <scale>0.8</scale>
            <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
          </IconStyle>
        </Style>
        <Point>
          <coordinates>${mainTrack[0].longitude},${mainTrack[0].latitude},0</coordinates>
        </Point>
      </Placemark>

      <Placemark>
        <name>Ende: ${escapeXml(run.runName)}</name>
        <Style>
          <IconStyle>
            <color>${color}</color>
            <scale>0.8</scale>
            <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_square.png</href></Icon>
          </IconStyle>
        </Style>
        <Point>
          <coordinates>${mainTrack[mainTrack.length - 1].longitude},${mainTrack[mainTrack.length - 1].latitude},0</coordinates>
        </Point>
      </Placemark>
    </Folder>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(projectName)} - GPS-Trajektorien</name>
    <description><![CDATA[
Projekt: ${escapeXml(projectName)}
Anzahl Messfahrten mit GPS: ${runsWithGps.length}
    ]]></description>
    ${styles}
    ${placemarks}
  </Document>
</kml>`
}

/**
 * Format GPS points as KML coordinate string
 */
function formatCoordinates(points: GpsPoint[]): string {
  return points
    .map(p => `${p.longitude},${p.latitude},0`)
    .join(' ')
}

/**
 * Escape special XML characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Download KML file
 */
export function downloadKML(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.kml') ? filename : `${filename}.kml`
  a.click()
  URL.revokeObjectURL(url)
}
