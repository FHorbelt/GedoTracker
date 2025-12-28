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
        bg-white rounded-xl border border-slate-200 shadow-sm
        ${hoverable ? 'hover:shadow-md hover:border-slate-300 transition-all cursor-pointer' : ''}
        ${className}
      `}
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
    <div className={`p-4 border-b border-slate-200 ${className}`}>
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
