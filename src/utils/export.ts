import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { Project, MeasurementRun } from '../db/models'
import { formatKmValue } from './kmCalculation'

interface ExportOptions {
  format: 'pdf' | 'excel' | 'csv' | 'json'
  project: Project
  runs: MeasurementRun[]
  language: 'de' | 'en'
}

const labels = {
  de: {
    projectProtocol: 'Projektprotokoll',
    projectNumber: 'Projektnummer',
    client: 'Auftraggeber',
    constructionProject: 'Bauvorhaben',
    object: 'Objekt',
    date: 'Datum',
    scanner: 'Scanner',
    orientation: 'Ausrichtung',
    tower: 'Turm',
    towerHeight: 'Turmhöhe',
    employees: 'Mitarbeiter',
    weather: 'Wetter',
    environment: 'Umgebung',
    measurementRuns: 'Messfahrten',
    runName: 'Fahrtname',
    track: 'Gleis',
    direction: 'Richtung',
    fromTo: 'Von-Bis',
    kmStation: 'KM-Station',
    length: 'Länge (m)',
    speed: 'Geschwindigkeit (m/s)',
    remarks: 'Bemerkungen',
    ascending: 'Aufsteigend',
    descending: 'Absteigend',
    yes: 'Ja',
    no: 'Nein',
    sunny: 'Sonnig',
    cloudy: 'Bewölkt',
    rainy: 'Regen',
    outdoor: 'Im Freien',
    covered: 'Überdacht',
    trackedPoints: 'Erfasste Punkte',
    pointNumber: 'Punktnummer',
    side: 'Seite',
    distance: 'Strecke (m)',
    kmValue: 'KM-Wert',
    targetBoard: 'Zieltafel',
    targetBoardSize: 'Größe',
    targetBoardHeight: 'Höhe (mm)',
    targetBoardThickness: 'Dicke (mm)',
    left: 'Links',
    right: 'Rechts'
  },
  en: {
    projectProtocol: 'Project Protocol',
    projectNumber: 'Project Number',
    client: 'Client',
    constructionProject: 'Construction Project',
    object: 'Object',
    date: 'Date',
    scanner: 'Scanner',
    orientation: 'Orientation',
    tower: 'Tower',
    towerHeight: 'Tower Height',
    employees: 'Employees',
    weather: 'Weather',
    environment: 'Environment',
    measurementRuns: 'Measurement Runs',
    runName: 'Run Name',
    track: 'Track',
    direction: 'Direction',
    fromTo: 'From-To',
    kmStation: 'KM Station',
    length: 'Length (m)',
    speed: 'Speed (m/s)',
    remarks: 'Remarks',
    ascending: 'Ascending',
    descending: 'Descending',
    yes: 'Yes',
    no: 'No',
    sunny: 'Sunny',
    cloudy: 'Cloudy',
    rainy: 'Rainy',
    outdoor: 'Outdoor',
    covered: 'Covered',
    trackedPoints: 'Tracked Points',
    pointNumber: 'Point Number',
    side: 'Side',
    distance: 'Distance (m)',
    kmValue: 'KM Value',
    targetBoard: 'Target Board',
    targetBoardSize: 'Size',
    targetBoardHeight: 'Height (mm)',
    targetBoardThickness: 'Thickness (mm)',
    left: 'Left',
    right: 'Right'
  }
}

export async function exportProject(options: ExportOptions): Promise<void> {
  const { format, project, runs, language } = options
  const l = labels[language]

  switch (format) {
    case 'pdf':
      exportToPDF(project, runs, l)
      break
    case 'excel':
      exportToExcel(project, runs, l)
      break
    case 'csv':
      exportToCSV(project, runs, l)
      break
    case 'json':
      exportToJSON(project, runs)
      break
  }
}

function exportToPDF(project: Project, runs: MeasurementRun[], l: typeof labels.de) {
  const doc = new jsPDF()

  // Title
  doc.setFontSize(18)
  doc.text(l.projectProtocol, 14, 20)

  // Project details
  doc.setFontSize(10)
  let y = 35
  const lineHeight = 7

  const addLine = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold')
    doc.text(`${label}:`, 14, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value, 60, y)
    y += lineHeight
  }

  addLine(l.projectNumber, project.projectNumber)
  addLine(l.client, project.client)
  addLine(l.constructionProject, project.constructionProject)
  addLine(l.object, project.object)
  addLine(l.date, project.date)
  addLine(l.scanner, `${project.scannerType} (${project.scannerOrientation})`)
  addLine(l.tower, project.withTower ? `${l.yes} (${project.towerHeight}mm)` : l.no)
  addLine(l.employees, project.employees.join(', '))
  addLine(l.weather, `${l[project.weather.condition as keyof typeof l]}, ${l[project.weather.environment as keyof typeof l]}`)

  // Runs overview table
  y += 10
  doc.setFontSize(14)
  doc.text(l.measurementRuns, 14, y)
  y += 5

  const tableData = runs.map(run => [
    run.runName,
    run.track,
    l[run.direction as keyof typeof l] || run.direction,
    `${run.pointNumberFrom} - ${run.pointNumberTo}`,
    run.length?.toString() || '',
    run.speed?.toString() || ''
  ])

  autoTable(doc, {
    startY: y,
    head: [[l.runName, l.track, l.direction, l.fromTo, l.length, l.speed]],
    body: tableData,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 64, 175] }
  })

  // Detailed points for each run
  runs.forEach(run => {
    if (run.trackedPoints && run.trackedPoints.length > 0) {
      doc.addPage()

      doc.setFontSize(14)
      doc.text(`${run.runName} - ${l.trackedPoints}`, 14, 20)

      const pointsData = run.trackedPoints.map(point => {
        const targetBoardStr = point.targetBoard
          ? `${point.targetBoard.size}mm / ${point.targetBoard.height >= 0 ? '+' : ''}${point.targetBoard.height}mm / ${point.targetBoard.thickness}mm`
          : '-'
        return [
          point.pointNumber,
          point.side === 'left' ? l.left : l.right,
          point.localDistance.toString(),
          formatKmValue(point.kmValue),
          targetBoardStr
        ]
      })

      autoTable(doc, {
        startY: 30,
        head: [[l.pointNumber, l.side, l.distance, l.kmValue, l.targetBoard]],
        body: pointsData,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 64, 175] }
      })

      // Add remarks if any
      if (run.remarks && run.remarks.length > 0) {
        const finalY = (doc as any).lastAutoTable?.finalY || 100
        doc.setFontSize(12)
        doc.text(l.remarks, 14, finalY + 10)

        run.remarks.forEach((remark, idx) => {
          doc.setFontSize(10)
          doc.text(`${idx + 1}. ${remark.text}`, 14, finalY + 20 + (idx * 7))
        })
      }
    }
  })

  doc.save(`${project.projectNumber}_protocol.pdf`)
}

function exportToExcel(project: Project, runs: MeasurementRun[], l: typeof labels.de) {
  // Project info sheet
  const projectData = [
    [l.projectNumber, project.projectNumber],
    [l.client, project.client],
    [l.constructionProject, project.constructionProject],
    [l.object, project.object],
    [l.date, project.date],
    [l.scanner, `${project.scannerType} (${project.scannerOrientation})`],
    [l.tower, project.withTower ? `${l.yes} (${project.towerHeight}mm)` : l.no],
    [l.employees, project.employees.join(', ')],
    [l.weather, `${project.weather.condition}, ${project.weather.environment}`]
  ]

  // Runs sheet
  const runsHeader = [l.runName, l.track, l.direction, l.fromTo, l.length, l.speed]
  const runsData = runs.map(run => [
    run.runName,
    run.track,
    run.direction,
    `${run.pointNumberFrom} - ${run.pointNumberTo}`,
    run.length || '',
    run.speed || ''
  ])

  const wb = XLSX.utils.book_new()

  const wsProject = XLSX.utils.aoa_to_sheet(projectData)
  XLSX.utils.book_append_sheet(wb, wsProject, 'Projekt')

  const wsRuns = XLSX.utils.aoa_to_sheet([runsHeader, ...runsData])
  XLSX.utils.book_append_sheet(wb, wsRuns, 'Messfahrten')

  // Add a sheet for each run with tracked points
  runs.forEach((run, idx) => {
    if (run.trackedPoints && run.trackedPoints.length > 0) {
      const pointsHeader = [l.pointNumber, l.side, l.distance, l.kmValue, l.targetBoardSize, l.targetBoardHeight, l.targetBoardThickness]
      const pointsData = run.trackedPoints.map(point => [
        point.pointNumber,
        point.side === 'left' ? l.left : l.right,
        point.localDistance,
        formatKmValue(point.kmValue),
        point.targetBoard?.size || '-',
        point.targetBoard?.height ?? '-',
        point.targetBoard?.thickness ?? '-'
      ])

      // Truncate sheet name to 31 chars (Excel limit)
      const sheetName = `${idx + 1}_${run.runName}`.substring(0, 31)
      const wsPoints = XLSX.utils.aoa_to_sheet([pointsHeader, ...pointsData])
      XLSX.utils.book_append_sheet(wb, wsPoints, sheetName)
    }
  })

  XLSX.writeFile(wb, `${project.projectNumber}_protocol.xlsx`)
}

function exportToCSV(project: Project, runs: MeasurementRun[], l: typeof labels.de) {
  // Export all tracked points with run info
  const header = [
    l.runName,
    l.pointNumber,
    l.side,
    l.distance,
    l.kmValue,
    l.targetBoardSize,
    l.targetBoardHeight,
    l.targetBoardThickness
  ].join(';')

  const rows: string[] = []
  runs.forEach(run => {
    if (run.trackedPoints) {
      run.trackedPoints.forEach(point => {
        rows.push([
          run.runName,
          point.pointNumber,
          point.side === 'left' ? l.left : l.right,
          point.localDistance,
          formatKmValue(point.kmValue),
          point.targetBoard?.size || '-',
          point.targetBoard?.height ?? '-',
          point.targetBoard?.thickness ?? '-'
        ].join(';'))
      })
    }
  })

  const csv = [header, ...rows].join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }) // BOM for Excel UTF-8
  saveAs(blob, `${project.projectNumber}_points.csv`)
}

function exportToJSON(project: Project, runs: MeasurementRun[]) {
  const data = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    project,
    runs
  }
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  saveAs(blob, `${project.projectNumber}_export.json`)
}
