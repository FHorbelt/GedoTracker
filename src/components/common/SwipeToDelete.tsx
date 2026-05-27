import { useRef, useState, useCallback, ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'

interface SwipeToDeleteProps {
  children: ReactNode
  onDelete: () => void
}

const THRESHOLD = 80
const DELETE_BUTTON_WIDTH = 80

export function SwipeToDelete({ children, onDelete }: SwipeToDeleteProps) {
  const { isDark } = useTheme()
  const [offset, setOffset] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [isSwiping, setIsSwiping] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const currentOffset = useRef(0)
  const directionLocked = useRef<'horizontal' | 'vertical' | null>(null)

  const isRevealed = offset < 0

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    startX.current = touch.clientX
    startY.current = touch.clientY
    currentOffset.current = isOpen ? -DELETE_BUTTON_WIDTH : 0
    directionLocked.current = null
    setIsSwiping(false)
  }, [isOpen])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    const deltaX = touch.clientX - startX.current
    const deltaY = touch.clientY - startY.current

    // Lock direction after 10px of movement
    if (!directionLocked.current) {
      if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
        directionLocked.current = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical'
      }
      return
    }

    // Allow vertical scrolling
    if (directionLocked.current === 'vertical') return

    setIsSwiping(true)
    const newOffset = Math.min(0, Math.max(-DELETE_BUTTON_WIDTH * 1.5, currentOffset.current + deltaX))
    setOffset(newOffset)
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (directionLocked.current !== 'horizontal') {
      setIsSwiping(false)
      return
    }

    if (offset < -THRESHOLD) {
      setOffset(-DELETE_BUTTON_WIDTH)
      setIsOpen(true)
    } else {
      setOffset(0)
      setIsOpen(false)
    }
    // Reset swiping after transition settles
    setTimeout(() => setIsSwiping(false), 50)
  }, [offset])

  const handleClose = useCallback(() => {
    setOffset(0)
    setIsOpen(false)
  }, [])

  const handleDelete = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation()
    e.preventDefault()
    onDelete()
    setOffset(0)
    setIsOpen(false)
  }, [onDelete])

  return (
    <div
      className="relative"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: 'pan-y' }}
    >
      {/* Delete button behind - only visible when swiping */}
      {isRevealed && (
        <div
          className="absolute right-0 top-0 bottom-0 flex items-center justify-center rounded-xl"
          style={{
            width: DELETE_BUTTON_WIDTH,
            backgroundColor: isDark ? 'transparent' : '#ef4444',
            border: isDark ? '1px solid #ef4444' : 'none',
          }}
          onClick={handleDelete}
          onTouchEnd={handleDelete}
        >
          <Trash2 className="w-5 h-5" style={{ color: isDark ? '#ef4444' : 'white' }} />
        </div>
      )}

      {/* Swipeable content */}
      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: isSwiping ? 'none' : 'transform 0.2s ease-out',
          position: 'relative',
          zIndex: 1,
        }}
        onClick={isOpen ? handleClose : undefined}
      >
        {children}
      </div>
    </div>
  )
}
