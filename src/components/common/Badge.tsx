import { ReactNode } from 'react'
import { useTheme } from '../../contexts/ThemeContext'

interface BadgeProps {
  children: ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info'
  className?: string
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const getVariantStyle = (): React.CSSProperties => {
    const colors = {
      default: { color: '#64748b', border: '#64748b', bg: '#f1f5f9' },
      success: { color: '#22c55e', border: '#22c55e', bg: '#dcfce7' },
      warning: { color: '#f59e0b', border: '#f59e0b', bg: '#fef3c7' },
      danger: { color: '#ef4444', border: '#ef4444', bg: '#fee2e2' },
      info: { color: '#3b82f6', border: '#3b82f6', bg: '#dbeafe' }
    }

    const c = colors[variant]

    if (isDark) {
      return {
        backgroundColor: 'transparent',
        color: c.color,
        border: `1px solid ${c.border}`
      }
    }

    return {
      backgroundColor: c.bg,
      color: c.color
    }
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${className}`}
      style={getVariantStyle()}
    >
      {children}
    </span>
  )
}
