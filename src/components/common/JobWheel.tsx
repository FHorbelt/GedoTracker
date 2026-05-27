import { useRef, useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Briefcase, Calendar, Scan } from 'lucide-react'
import { MeasurementJob } from '../../db/models'
import { Badge } from './Badge'

// Haptic feedback utility - works on Android, not supported on iOS Safari
const triggerHaptic = (style: 'light' | 'medium' | 'heavy' = 'light') => {
  if ('vibrate' in navigator) {
    const duration = style === 'light' ? 10 : style === 'medium' ? 20 : 30
    navigator.vibrate(duration)
  }
}

interface JobWheelProps {
  jobs: MeasurementJob[]
  selectedJobId: string | null
  onSelectJob: (jobId: string) => void
  onNavigateToJob: (jobId: string) => void
  runCounts?: Record<string, number>
  compact?: boolean
}

export function JobWheel({
  jobs,
  selectedJobId,
  onSelectJob,
  onNavigateToJob,
  runCounts = {},
  compact = false
}: JobWheelProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastCenterIndexRef = useRef<number>(0)
  const lastCompactRef = useRef(compact)
  const isInternalSelectionRef = useRef(false)

  // Track scroll position for fluid animations
  const [scrollPosition, setScrollPosition] = useState(0)

  const ITEM_HEIGHT = compact ? 60 : 120
  const VISIBLE_ITEMS = compact ? 5 : 3
  const CONTAINER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS

  // Scroll to selected job on mount or when compact mode changes
  useEffect(() => {
    if (!containerRef.current) return

    // Skip if this is an internal selection change (from scrolling)
    if (isInternalSelectionRef.current) {
      isInternalSelectionRef.current = false
      return
    }

    const index = selectedJobId ? jobs.findIndex(j => j.id === selectedJobId) : 0
    const safeIndex = Math.max(0, index)
    const targetScroll = safeIndex * ITEM_HEIGHT

    // Use instant scroll when compact mode changes, smooth otherwise
    const isCompactChange = lastCompactRef.current !== compact
    lastCompactRef.current = compact

    containerRef.current.scrollTo({
      top: targetScroll,
      behavior: isCompactChange ? 'instant' : 'smooth'
    })
    setScrollPosition(targetScroll)
  }, [selectedJobId, jobs, ITEM_HEIGHT, compact])

  // Fluid scroll handler with requestAnimationFrame
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return

    // Cancel any pending animation frame
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }

    // Update scroll position immediately for fluid animation
    rafRef.current = requestAnimationFrame(() => {
      if (containerRef.current) {
        const scrollTop = containerRef.current.scrollTop
        setScrollPosition(scrollTop)

        // Check if we crossed an item boundary for haptic feedback
        const currentCenterIndex = Math.round(scrollTop / ITEM_HEIGHT)
        if (currentCenterIndex !== lastCenterIndexRef.current) {
          lastCenterIndexRef.current = currentCenterIndex
          triggerHaptic('light')
        }
      }
    })

    // Clear previous snap timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    // Snap after scrolling stops
    scrollTimeoutRef.current = setTimeout(() => {
      if (!containerRef.current) return

      const scrollTop = containerRef.current.scrollTop
      const index = Math.round(scrollTop / ITEM_HEIGHT)
      const clampedIndex = Math.max(0, Math.min(index, jobs.length - 1))

      // Snap to nearest item
      containerRef.current.scrollTo({
        top: clampedIndex * ITEM_HEIGHT,
        behavior: 'smooth'
      })

      // Haptic feedback on snap
      triggerHaptic('medium')

      // Update selection (mark as internal to prevent useEffect from re-scrolling)
      if (jobs[clampedIndex]) {
        isInternalSelectionRef.current = true
        onSelectJob(jobs[clampedIndex].id)
      }
    }, 80)
  }, [jobs, onSelectJob, ITEM_HEIGHT])

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  // Calculate styles based on distance from center - updates fluidly during scroll
  const getItemStyle = (index: number): React.CSSProperties => {
    const centerOffset = scrollPosition / ITEM_HEIGHT
    const distance = Math.abs(index - centerOffset)

    // Smooth interpolation values
    const opacity = Math.max(0.35, 1 - distance * 0.35)
    const scale = Math.max(0.88, 1 - distance * 0.06)
    const blur = distance > 0.3 ? Math.min(distance * 1.2, 2) : 0

    return {
      opacity,
      transform: `scale(${scale})`,
      filter: blur > 0 ? `blur(${blur}px)` : 'none',
      // No transition - we want immediate response during scroll
      willChange: 'transform, opacity, filter'
    }
  }

  // Calculate dynamic text/icon sizes based on proximity to center
  const getProximity = (index: number): number => {
    const centerOffset = scrollPosition / ITEM_HEIGHT
    const distance = Math.abs(index - centerOffset)
    // Returns 1 when at center, 0 when far away
    return Math.max(0, 1 - distance)
  }

  if (jobs.length === 0) {
    return (
      <div
        className={`flex flex-col items-center justify-center rounded-xl ${compact ? 'py-6' : 'py-12'}`}
        style={{
          backgroundColor: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          minHeight: compact ? 120 : CONTAINER_HEIGHT
        }}
      >
        <Briefcase className={compact ? 'w-8 h-8 mb-2' : 'w-12 h-12 mb-3'} style={{ color: 'var(--color-text-muted)' }} />
        <p className={compact ? 'text-sm' : 'text-lg'} style={{ color: 'var(--color-text-muted)' }}>{t('measurementJob.noJobs')}</p>
      </div>
    )
  }

  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{
        backgroundColor: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)'
      }}
    >
      {/* Gradient overlays for fade effect */}
      <div
        className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
        style={{
          height: ITEM_HEIGHT * 0.85,
          background: 'linear-gradient(to bottom, var(--color-bg-card) 10%, transparent 100%)'
        }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none"
        style={{
          height: ITEM_HEIGHT * 0.85,
          background: 'linear-gradient(to top, var(--color-bg-card) 10%, transparent 100%)'
        }}
      />

      {/* Scrollable container */}
      <div
        ref={containerRef}
        className="overflow-y-auto scrollbar-hide"
        style={{
          height: CONTAINER_HEIGHT,
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch'
        }}
        onScroll={handleScroll}
      >
        {/* Top padding to allow first item to be centered */}
        <div style={{ height: ITEM_HEIGHT }} />

        {jobs.map((job, index) => {
          const proximity = getProximity(index)
          // Interpolate sizes based on proximity (0 = far, 1 = center)
          const titleSize = compact ? (14 + proximity * 2) : (16 + proximity * 4)
          const chevronSize = compact ? (18 + proximity * 4) : (20 + proximity * 8)

          return (
            <div
              key={job.id}
              className={`flex items-center cursor-pointer ${compact ? 'px-4' : 'px-5'}`}
              style={{
                height: ITEM_HEIGHT,
                scrollSnapAlign: 'center',
                ...getItemStyle(index)
              }}
              onClick={() => onNavigateToJob(job.id)}
            >
              <div className="flex-1 min-w-0">
                {/* Job Name - size interpolates smoothly */}
                <div
                  className="font-semibold truncate"
                  style={{
                    color: 'var(--color-text)',
                    fontSize: `${titleSize}px`,
                    lineHeight: 1.3
                  }}
                >
                  {job.jobName}
                </div>

                {compact ? (
                  /* Compact mode: single line with date and run count */
                  <div className="flex items-center gap-2 mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    <span>{job.jobDate}</span>
                    <span>•</span>
                    <span>{runCounts[job.id] || 0} {t('measurementJob.runs')}</span>
                  </div>
                ) : (
                  /* Full mode: date with icon and badges */
                  <>
                    <div className="flex items-center gap-2 mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      <Calendar className="w-4 h-4 flex-shrink-0" />
                      <span className="text-sm">
                        {job.jobDate}
                        {job.object && ` • ${job.object}`}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Badge variant="info">
                        {runCounts[job.id] || 0} {t('measurementJob.runs')}
                      </Badge>
                      {job.scannerType && (
                        <Badge variant="default">
                          <Scan className="w-3 h-3 mr-1" />
                          {job.scannerType}
                          {job.scannerAlignment && ` ${job.scannerAlignment}`}
                        </Badge>
                      )}
                      {job.withTower && (
                        <Badge variant="success">
                          {t('measurementJob.withTower')}
                        </Badge>
                      )}
                    </div>
                  </>
                )}
              </div>

              <ChevronRight
                className="flex-shrink-0"
                style={{
                  width: chevronSize,
                  height: chevronSize,
                  color: proximity > 0.5 ? '#3b82f6' : 'var(--color-text-muted)'
                }}
              />
            </div>
          )
        })}

        {/* Bottom padding to allow last item to be centered */}
        <div style={{ height: ITEM_HEIGHT }} />
      </div>
    </div>
  )
}
