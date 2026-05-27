import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { Project, MeasurementJob, MeasurementRun, Employee, CompanyLogo, FixedPointField } from '../db/models'
import { formatKmValue } from './kmCalculation'
import { db } from '../db/database'

// === TYPES ===

interface ProjectExportOptions {
  format: 'pdf' | 'excel' | 'json'
  project: Project
  jobs: MeasurementJob[]
  runs: MeasurementRun[]
  language: 'de' | 'en'
}

interface JobExportOptions {
  format: 'pdf' | 'excel' | 'json'
  project: Project
  job: MeasurementJob
  runs: MeasurementRun[]
  language: 'de' | 'en'
}

// === LABELS ===

const labels = {
  de: {
    projectProtocol: 'Projektprotokoll',
    jobProtocol: 'Messjob-Protokoll',
    projectNumber: 'Projektnummer',
    client: 'Auftraggeber',
    constructionProject: 'Bauvorhaben',
    object: 'Objekt',
    startDate: 'Startdatum',
    scanner: 'Scanner',
    scannerType: 'Scannertyp',
    scannerAlignment: 'Ausrichtung',
    trolley: 'Trolley',
    tower: 'Turm',
    towerHeight: 'Turmhöhe',
    employees: 'Mitarbeiter',
    weather: 'Wetter',
    environment: 'Umgebung',
    measurementJobs: 'Messjobs',
    measurementRuns: 'Messfahrten',
    jobName: 'Jobname',
    jobDate: 'Jobdatum',
    runName: 'Fahrtname',
    routeNumber: 'Streckennummer',
    track: 'Gleis',
    direction: 'Richtung',
    kmRange: 'KM-Bereich',
    length: 'Länge (m)',
    speed: 'Geschw. (m/s)',
    remarks: 'Bemerkungen',
    ascending: 'Aufsteigend',
    descending: 'Absteigend',
    yes: 'Ja',
    no: 'Nein',
    sunny: 'Sonnig',
    cloudy: 'Bewölkt',
    rainy: 'Regen',
    outdoor: 'Im Freien',
    covered: 'Überdacht/Tunnel',
    trackedPoints: 'Erfasste Punkte',
    pointNumber: 'Punktnummer',
    side: 'Seite',
    distance: 'Strecke (m)',
    kmValue: 'KM-Wert',
    targetBoard: 'Zieltafel',
    targetBoardSize: 'Seite (mm)',
    targetBoardHeight: 'Höhe (mm)',
    targetBoardThickness: 'Dicke (mm)',
    left: 'Links',
    right: 'Rechts',
    remark: 'Bemerkung',
    page: 'Seite',
    continued: 'Fortsetzung',
    noPoints: 'Keine Punkte erfasst'
  },
  en: {
    projectProtocol: 'Project Protocol',
    jobProtocol: 'Measurement Job Protocol',
    projectNumber: 'Project Number',
    client: 'Client',
    constructionProject: 'Construction Project',
    object: 'Object',
    startDate: 'Start Date',
    scanner: 'Scanner',
    scannerType: 'Scanner Type',
    scannerAlignment: 'Alignment',
    trolley: 'Trolley',
    tower: 'Tower',
    towerHeight: 'Tower Height',
    employees: 'Employees',
    weather: 'Weather',
    environment: 'Environment',
    measurementJobs: 'Measurement Jobs',
    measurementRuns: 'Measurement Runs',
    jobName: 'Job Name',
    jobDate: 'Job Date',
    runName: 'Run Name',
    routeNumber: 'Route Number',
    track: 'Track',
    direction: 'Direction',
    kmRange: 'KM Range',
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
    covered: 'Covered/Tunnel',
    trackedPoints: 'Tracked Points',
    pointNumber: 'Point Number',
    side: 'Side',
    distance: 'Distance (m)',
    kmValue: 'KM Value',
    targetBoard: 'Target Board',
    targetBoardSize: 'Size (mm)',
    targetBoardHeight: 'Height (mm)',
    targetBoardThickness: 'Thickness (mm)',
    left: 'Left',
    right: 'Right',
    remark: 'Remark',
    page: 'Page',
    continued: 'Continued',
    noPoints: 'No points tracked'
  }
}

// === PROJECT EXPORT (all jobs with runs) ===

export async function exportProject(options: ProjectExportOptions): Promise<void> {
  const { format, project, jobs, runs, language } = options
  const l = labels[language]
  const employees = await db.employees.toArray()

  switch (format) {
    case 'pdf':
      await exportProjectToPDF(project, jobs, runs, employees, l)
      break
    case 'excel':
      exportProjectToExcel(project, jobs, runs, employees, l)
      break
    case 'json':
      await exportProjectToJSON(project, jobs, runs)
      break
  }
}

// === JOB EXPORT (single job with runs) ===

export async function exportJob(options: JobExportOptions): Promise<void> {
  const { format, project, job, runs, language } = options
  const l = labels[language]
  const employees = await db.employees.toArray()

  switch (format) {
    case 'pdf':
      await exportJobToPDF(project, job, runs, employees, l)
      break
    case 'excel':
      exportJobToExcel(project, job, runs, employees, l)
      break
    case 'json':
      await exportJobToJSON(project, job, runs)
      break
  }
}

// === PDF HELPERS ===

function getWeatherLabel(condition: string, l: typeof labels.de): string {
  const map: Record<string, string> = {
    sunny: l.sunny,
    cloudy: l.cloudy,
    rainy: l.rainy
  }
  return map[condition] || condition
}

function getEnvironmentLabel(env: string, l: typeof labels.de): string {
  const map: Record<string, string> = {
    outdoor: l.outdoor,
    covered: l.covered
  }
  return map[env] || env
}

function getEmployeeNames(ids: string[], employees: Employee[]): string {
  return ids
    .map(id => employees.find(e => e.id === id)?.name)
    .filter(Boolean)
    .join(', ') || '-'
}

function addProjectHeader(doc: jsPDF, project: Project, l: typeof labels.de, isJobExport: boolean = false, logo?: CompanyLogo) {
  const pageWidth = doc.internal.pageSize.getWidth()

  // Title (left-aligned)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(isJobExport ? l.jobProtocol : l.projectProtocol, 14, 20)

  // Logo or placeholder (right side) - max 40x18mm area, aspect ratio preserved
  const maxLogoWidth = 40
  const maxLogoHeight = 18
  const logoX = pageWidth - 14 // Right edge position
  const logoY = 10

  if (logo) {
    // Add actual logo image with preserved aspect ratio
    try {
      const imgData = `data:${logo.mimeType};base64,${logo.imageData}`

      // Get image properties from jsPDF to calculate aspect ratio
      const imgProps = doc.getImageProperties(imgData)

      // Calculate scaled dimensions maintaining aspect ratio
      let logoWidth = maxLogoWidth
      let logoHeight = maxLogoHeight

      if (imgProps.width && imgProps.height) {
        const aspectRatio = imgProps.width / imgProps.height

        // Try fitting to max width first
        logoWidth = maxLogoWidth
        logoHeight = maxLogoWidth / aspectRatio

        // If height exceeds max, fit to max height instead
        if (logoHeight > maxLogoHeight) {
          logoHeight = maxLogoHeight
          logoWidth = maxLogoHeight * aspectRatio
        }
      }

      // Position logo right-aligned
      const finalX = logoX - logoWidth
      doc.addImage(imgData, imgProps.fileType || 'PNG', finalX, logoY, logoWidth, logoHeight)
    } catch (e) {
      // Fallback to placeholder if image fails
      console.error('Error adding logo to PDF:', e)
      doc.setDrawColor(200)
      doc.setFillColor(245, 245, 245)
      doc.roundedRect(logoX - maxLogoWidth, logoY, maxLogoWidth, maxLogoHeight, 2, 2, 'FD')
      doc.setFontSize(8)
      doc.setTextColor(150)
      doc.text('Logo', logoX - maxLogoWidth / 2, logoY + 11, { align: 'center' })
      doc.setTextColor(0)
    }
  } else {
    // Show placeholder
    doc.setDrawColor(200)
    doc.setFillColor(245, 245, 245)
    doc.roundedRect(logoX - maxLogoWidth, logoY, maxLogoWidth, maxLogoHeight, 2, 2, 'FD')
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text('Logo', logoX - maxLogoWidth / 2, logoY + 11, { align: 'center' })
    doc.setTextColor(0)
  }

  // Project info (left-aligned)
  doc.setFontSize(9)
  let y = 35
  const lineHeight = 5

  const addInfoLine = (label: string, value: string | undefined) => {
    if (!value) return
    doc.setFont('helvetica', 'bold')
    doc.text(`${label}:`, 14, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value, 55, y)
    y += lineHeight
  }

  addInfoLine(l.projectNumber, project.projectNumber)
  if (project.client) addInfoLine(l.client, project.client)
  if (project.constructionProject) addInfoLine(l.constructionProject, project.constructionProject)
  addInfoLine(l.startDate, project.startDate)

  return y
}

function addJobInfo(doc: jsPDF, job: MeasurementJob, employees: Employee[], l: typeof labels.de, startY: number): number {
  let y = startY
  const lineHeight = 5

  const addInfoLine = (label: string, value: string | undefined) => {
    if (!value) return
    doc.setFont('helvetica', 'bold')
    doc.text(`${label}:`, 14, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value, 55, y)
    y += lineHeight
  }

  doc.setFontSize(9)
  addInfoLine(l.jobDate, job.jobDate)
  if (job.object) addInfoLine(l.object, job.object)
  addInfoLine(l.scannerType, `${job.scannerType}${job.scannerAlignment ? ` (${job.scannerAlignment})` : ''}`)
  if (job.trolleySerialNumber) addInfoLine(l.trolley, job.trolleySerialNumber)
  if (job.scannerSerialNumber) addInfoLine(l.scanner, job.scannerSerialNumber)
  if (job.withTower) addInfoLine(l.tower, `${l.yes} (${job.towerHeight}mm)`)
  addInfoLine(l.weather, `${getWeatherLabel(job.weather.condition, l)}, ${getEnvironmentLabel(job.weather.environment, l)}`)
  if (job.employeeIds.length > 0) addInfoLine(l.employees, getEmployeeNames(job.employeeIds, employees))

  return y
}

function addRunsTable(
  doc: jsPDF,
  runs: MeasurementRun[],
  l: typeof labels.de,
  startY: number,
  showJobColumn: boolean = false
): number {
  if (runs.length === 0) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'italic')
    doc.text(l.noPoints, 14, startY + 5)
    return startY + 15
  }

  let y = startY

  // Sort runs by creation time (actual measurement order)
  const sortedRuns = [...runs].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )

  // For each run, show run info and points table
  sortedRuns.forEach((run, runIndex) => {
    const pageWidth = doc.internal.pageSize.getWidth()
    const marginLeft = 14
    const contentWidth = pageWidth - 28

    // Check if we need a new page
    if (y > 250) {
      doc.addPage()
      y = 20
    }

    // Run header (blue background, white text)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setFillColor(30, 64, 175)
    doc.rect(marginLeft, y - 4, contentWidth, 7, 'F')
    doc.setTextColor(255)
    doc.text(run.runName, 16, y)
    doc.setTextColor(0)
    y += 8

    // Run details - structured vertical layout
    const lineHeight = 4.5
    const addRunInfoLine = (label: string, value: string) => {
      doc.setFont('helvetica', 'bold')
      doc.text(`${label}:`, 14, y)
      doc.setFont('helvetica', 'normal')
      doc.text(value, 45, y)
      y += lineHeight
    }

    doc.setFontSize(8)
    const dirLabel = run.direction === 'ascending' ? l.ascending : l.descending

    addRunInfoLine(l.routeNumber, run.routeNumber || '-')
    addRunInfoLine(l.track, run.trackType || '-')
    addRunInfoLine(l.direction, dirLabel)
    addRunInfoLine(l.kmRange, `${formatKmValue(run.startKm)} - ${run.endKm ? formatKmValue(run.endKm) : '-'}`)
    addRunInfoLine(l.length, `${run.length || '-'}m`)
    addRunInfoLine(l.speed, `${run.speed || '-'} m/s`)
    y += 2

    // Points table
    if (run.trackedPoints && run.trackedPoints.length > 0) {
      const pointsData = run.trackedPoints.map(point => [
          point.pointNumber,
          point.side === 'left' ? l.left : l.right,
          point.localDistance.toFixed(1),
          formatKmValue(point.kmValue),
          point.targetBoard ? point.targetBoard.size : '-',
          point.targetBoard ? `${point.targetBoard.height >= 0 ? '+' : ''}${point.targetBoard.height}` : '-',
          point.targetBoard ? String(point.targetBoard.thickness) : '-',
          point.remark || ''
      ])

      autoTable(doc, {
        startY: y,
        head: [
          [
            { content: l.pointNumber, rowSpan: 2 },
            { content: l.side, rowSpan: 2 },
            { content: l.distance, rowSpan: 2 },
            { content: l.kmValue, rowSpan: 2 },
            { content: l.targetBoard, colSpan: 3, styles: { halign: 'center' } },
            { content: l.remark, rowSpan: 2 }
          ],
          [
            { content: l.targetBoardSize },
            { content: l.targetBoardHeight },
            { content: l.targetBoardThickness }
          ]
        ],
        body: pointsData,
        styles: { fontSize: 7, cellPadding: 1.5, lineColor: [200, 200, 200], lineWidth: { left: 0.2, right: 0.2, top: 0, bottom: 0 } },
        headStyles: { fillColor: [255, 255, 255], textColor: [30, 64, 175], fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 13 },
          2: { cellWidth: 18 },
          3: { cellWidth: 24 },
          4: { cellWidth: 12 },
          5: { cellWidth: 12 },
          6: { cellWidth: 12 },
          7: { cellWidth: 'auto' }
        },
        margin: { left: 14, right: 14, top: 25 },
        showHead: 'everyPage',
        didDrawPage: (data) => {
          // Add formatted run header on continued pages
          if (data.pageNumber > 1) {
            const pageWidth = doc.internal.pageSize.getWidth()
            doc.setFontSize(10)
            doc.setFont('helvetica', 'bold')
            doc.setFillColor(30, 64, 175)
            doc.rect(14, 12, pageWidth - 28, 7, 'F')
            doc.setTextColor(255)
            doc.text(`${run.runName} (${l.continued})`, 16, 17)
            doc.setTextColor(0)
          }
        }
      })

      y = (doc as any).lastAutoTable?.finalY + 5 || y + 20
    } else {
      doc.setFontSize(8)
      doc.setFont('helvetica', 'italic')
      doc.text(l.noPoints, 14, y)
      y += 8
    }

    // Run remarks
    if (run.remarks && run.remarks.length > 0) {
      doc.setFontSize(8)
      doc.setFont('helvetica', 'bold')
      doc.text(`${l.remarks}:`, 14, y)
      y += 4
      doc.setFont('helvetica', 'normal')
      run.remarks.forEach((remark) => {
        doc.text(`• ${remark.text}`, 16, y)
        y += 4
      })
    }

    y += 10 // Space between runs
  })

  return y
}

// === PROJECT PDF ===

async function exportProjectToPDF(
  project: Project,
  jobs: MeasurementJob[],
  runs: MeasurementRun[],
  employees: Employee[],
  l: typeof labels.de
) {
  const doc = new jsPDF()

  // Get logo from project
  let logo: CompanyLogo | undefined
  if (project.logoId) {
    logo = await db.logos.get(project.logoId)
  }

  let y = addProjectHeader(doc, project, l, false, logo)
  y += 5

  // Summary line
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`${jobs.length} ${l.measurementJobs}, ${runs.length} ${l.measurementRuns}`, 14, y)
  y += 10

  // For each job
  jobs.forEach((job, jobIndex) => {
    // New page for each job (except first)
    if (jobIndex > 0) {
      doc.addPage()
      y = 20
    }

    // Job section header
    doc.setFillColor(30, 64, 175)
    doc.rect(14, y - 4, doc.internal.pageSize.getWidth() - 28, 8, 'F')
    doc.setTextColor(255)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(`Job: ${job.jobName}`, 16, y + 1)
    doc.setTextColor(0)
    y += 10

    // Job info
    y = addJobInfo(doc, job, employees, l, y)
    y += 5

    // Runs for this job
    const jobRuns = runs.filter(r => r.measurementJobId === job.id)

    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(`${l.measurementRuns} (${jobRuns.length})`, 14, y)
    y += 10

    y = addRunsTable(doc, jobRuns, l, y)
  })

  doc.save(`${project.projectNumber}_protokoll.pdf`)
}

// === JOB PDF ===

async function exportJobToPDF(
  project: Project,
  job: MeasurementJob,
  runs: MeasurementRun[],
  employees: Employee[],
  l: typeof labels.de
) {
  const doc = new jsPDF()

  // Get logo from project
  let logo: CompanyLogo | undefined
  if (project.logoId) {
    logo = await db.logos.get(project.logoId)
  }

  let y = addProjectHeader(doc, project, l, true, logo)
  y += 5

  // Job info
  y = addJobInfo(doc, job, employees, l, y)
  y += 8

  // Runs
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(`${l.measurementRuns} (${runs.length})`, 14, y)
  y += 10

  addRunsTable(doc, runs, l, y)

  doc.save(`${project.projectNumber}_${job.jobName}_protokoll.pdf`)
}

// === EXCEL EXPORTS ===

function exportProjectToExcel(
  project: Project,
  jobs: MeasurementJob[],
  runs: MeasurementRun[],
  employees: Employee[],
  l: typeof labels.de
) {
  const wb = XLSX.utils.book_new()

  // Project sheet
  const projectData = [
    [l.projectNumber, project.projectNumber],
    [l.client, project.client || '-'],
    [l.constructionProject, project.constructionProject || '-'],
    [l.startDate, project.startDate]
  ]
  const wsProject = XLSX.utils.aoa_to_sheet(projectData)
  XLSX.utils.book_append_sheet(wb, wsProject, 'Projekt')

  // Jobs sheet
  const jobsHeader = [l.jobName, l.jobDate, l.object, l.scannerType, l.trolley, l.scanner, l.tower, l.weather, l.employees]
  const jobsData = jobs.map(job => [
    job.jobName,
    job.jobDate,
    job.object || '-',
    `${job.scannerType} ${job.scannerAlignment || ''}`,
    job.trolleySerialNumber || '-',
    job.scannerSerialNumber || '-',
    job.withTower ? `${l.yes} (${job.towerHeight}mm)` : l.no,
    `${getWeatherLabel(job.weather.condition, l)}, ${getEnvironmentLabel(job.weather.environment, l)}`,
    getEmployeeNames(job.employeeIds, employees)
  ])
  const wsJobs = XLSX.utils.aoa_to_sheet([jobsHeader, ...jobsData])
  XLSX.utils.book_append_sheet(wb, wsJobs, 'Messjobs')

  // Runs sheet - sorted by creation time
  const sortedRuns = [...runs].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
  const runsHeader = [l.jobName, l.runName, l.routeNumber, l.track, l.direction, l.kmRange, l.length, l.speed]
  const runsData = sortedRuns.map(run => {
    const job = jobs.find(j => j.id === run.measurementJobId)
    return [
      job?.jobName || '-',
      run.runName,
      run.routeNumber || '-',
      run.trackType || '-',
      run.direction === 'ascending' ? l.ascending : l.descending,
      `${formatKmValue(run.startKm)} - ${run.endKm ? formatKmValue(run.endKm) : '-'}`,
      run.length || '',
      run.speed || ''
    ]
  })
  const wsRuns = XLSX.utils.aoa_to_sheet([runsHeader, ...runsData])
  XLSX.utils.book_append_sheet(wb, wsRuns, 'Messfahrten')

  // Points sheets per run
  sortedRuns.forEach((run, idx) => {
    if (run.trackedPoints && run.trackedPoints.length > 0) {
      const job = jobs.find(j => j.id === run.measurementJobId)
      const pointsHeader = [l.pointNumber, l.side, l.distance, l.kmValue, l.targetBoard, l.remark]
      const pointsData = run.trackedPoints.map(point => [
        point.pointNumber,
        point.side === 'left' ? l.left : l.right,
        point.localDistance,
        formatKmValue(point.kmValue),
        point.targetBoard ? `${point.targetBoard.size}/${point.targetBoard.height}/${point.targetBoard.thickness}` : '-',
        point.remark || ''
      ])

      const sheetName = `${idx + 1}_${run.runName}`.substring(0, 31).replace(/[\\/*?[\]]/g, '')
      const wsPoints = XLSX.utils.aoa_to_sheet([pointsHeader, ...pointsData])
      XLSX.utils.book_append_sheet(wb, wsPoints, sheetName)
    }
  })

  XLSX.writeFile(wb, `${project.projectNumber}_export.xlsx`)
}

function exportJobToExcel(
  project: Project,
  job: MeasurementJob,
  runs: MeasurementRun[],
  employees: Employee[],
  l: typeof labels.de
) {
  const wb = XLSX.utils.book_new()

  // Job info sheet
  const jobData = [
    [l.projectNumber, project.projectNumber],
    [l.client, project.client || '-'],
    ['', ''],
    [l.jobName, job.jobName],
    [l.jobDate, job.jobDate],
    [l.object, job.object || '-'],
    [l.scannerType, `${job.scannerType} ${job.scannerAlignment || ''}`],
    [l.trolley, job.trolleySerialNumber || '-'],
    [l.scanner, job.scannerSerialNumber || '-'],
    [l.tower, job.withTower ? `${l.yes} (${job.towerHeight}mm)` : l.no],
    [l.weather, `${getWeatherLabel(job.weather.condition, l)}, ${getEnvironmentLabel(job.weather.environment, l)}`],
    [l.employees, getEmployeeNames(job.employeeIds, employees)]
  ]
  const wsJob = XLSX.utils.aoa_to_sheet(jobData)
  XLSX.utils.book_append_sheet(wb, wsJob, 'Messjob')

  // Runs sheet - sorted by creation time
  const sortedRuns = [...runs].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
  const runsHeader = [l.runName, l.routeNumber, l.track, l.direction, l.kmRange, l.length, l.speed]
  const runsData = sortedRuns.map(run => [
    run.runName,
    run.routeNumber || '-',
    run.trackType || '-',
    run.direction === 'ascending' ? l.ascending : l.descending,
    `${formatKmValue(run.startKm)} - ${run.endKm ? formatKmValue(run.endKm) : '-'}`,
    run.length || '',
    run.speed || ''
  ])
  const wsRuns = XLSX.utils.aoa_to_sheet([runsHeader, ...runsData])
  XLSX.utils.book_append_sheet(wb, wsRuns, 'Messfahrten')

  // Points sheets per run
  sortedRuns.forEach((run, idx) => {
    if (run.trackedPoints && run.trackedPoints.length > 0) {
      const pointsHeader = [l.pointNumber, l.side, l.distance, l.kmValue, l.targetBoard, l.remark]
      const pointsData = run.trackedPoints.map(point => [
        point.pointNumber,
        point.side === 'left' ? l.left : l.right,
        point.localDistance,
        formatKmValue(point.kmValue),
        point.targetBoard ? `${point.targetBoard.size}/${point.targetBoard.height}/${point.targetBoard.thickness}` : '-',
        point.remark || ''
      ])

      const sheetName = `${idx + 1}_${run.runName}`.substring(0, 31).replace(/[\\/*?[\]]/g, '')
      const wsPoints = XLSX.utils.aoa_to_sheet([pointsHeader, ...pointsData])
      XLSX.utils.book_append_sheet(wb, wsPoints, sheetName)
    }
  })

  XLSX.writeFile(wb, `${project.projectNumber}_${job.jobName}_export.xlsx`)
}

// === JSON EXPORTS ===

async function exportProjectToJSON(project: Project, jobs: MeasurementJob[], runs: MeasurementRun[]) {
  // Collect all unique fixedPointFieldIds from jobs
  const fixedPointFieldIds = new Set<string>()
  jobs.forEach(job => {
    if (job.fixedPointFieldId) {
      fixedPointFieldIds.add(job.fixedPointFieldId)
    }
  })

  // Collect all unique employeeIds from jobs
  const employeeIds = new Set<string>()
  jobs.forEach(job => {
    job.employeeIds?.forEach(id => employeeIds.add(id))
  })

  // Load fixedPointFields
  const fixedPointFields: FixedPointField[] = []
  for (const fieldId of fixedPointFieldIds) {
    const field = await db.fixedPointFields.get(fieldId)
    if (field) {
      fixedPointFields.push(field)
    }
  }

  // Load employees
  const employees: Employee[] = []
  for (const empId of employeeIds) {
    const emp = await db.employees.get(empId)
    if (emp) {
      employees.push(emp)
    }
  }

  // Load logo if project has one
  let logo: CompanyLogo | undefined
  if (project.logoId) {
    logo = await db.logos.get(project.logoId)
  }

  const data = {
    version: '2.1.0',
    exportType: 'project',
    exportedAt: new Date().toISOString(),
    project,
    measurementJobs: jobs,
    runs,
    // Additional data for complete import
    fixedPointFields,
    employees,
    logo: logo || undefined
  }
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  saveAs(blob, `${project.projectNumber}_export.json`)
}

async function exportJobToJSON(project: Project, job: MeasurementJob, runs: MeasurementRun[]) {
  // Load fixedPointField if job has one
  let fixedPointField: FixedPointField | undefined
  if (job.fixedPointFieldId) {
    fixedPointField = await db.fixedPointFields.get(job.fixedPointFieldId)
  }

  // Load employees for this job
  const employees: Employee[] = []
  for (const empId of job.employeeIds || []) {
    const emp = await db.employees.get(empId)
    if (emp) {
      employees.push(emp)
    }
  }

  // Load logo if project has one
  let logo: CompanyLogo | undefined
  if (project.logoId) {
    logo = await db.logos.get(project.logoId)
  }

  const data = {
    version: '2.1.0',
    exportType: 'job',
    exportedAt: new Date().toISOString(),
    project,
    measurementJob: job,
    runs,
    // Additional data for complete import
    fixedPointField: fixedPointField || undefined,
    employees,
    logo: logo || undefined
  }
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  saveAs(blob, `${project.projectNumber}_${job.jobName}_export.json`)
}
