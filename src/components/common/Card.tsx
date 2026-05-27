import { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  onClick?: () => void
  hoverable?: boolean
}

export function Card({ children, className = '', onClick, hoverable }: CardProps) {
  return (
    <div
      className={`
        rounded-xl shadow-sm
        ${hoverable ? 'hover:shadow-md transition-all cursor-pointer' : ''}
        ${className}
      `}
      style={{
        backgroundColor: 'var(--color-bg-card)',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'var(--color-border)',
        color: 'var(--color-text)'
      }}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

interface CardHeaderProps {
  children: ReactNode
  className?: string
}

export function CardHeader({ children, className = '' }: CardHeaderProps) {
  return (
    <div className={`p-4 ${className}`} style={{ borderBottom: '1px solid var(--color-border)' }}>
      {children}
    </div>
  )
}

interface CardContentProps {
  children: ReactNode
  className?: string
}

export function CardContent({ children, className = '' }: CardContentProps) {
  return (
    <div className={`p-4 ${className}`}>
      {children}
    </div>
  )
}
