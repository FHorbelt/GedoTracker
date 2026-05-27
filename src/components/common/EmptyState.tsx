import { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon && (
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
          style={{
            backgroundColor: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)'
          }}
        >
          {icon}
        </div>
      )}
      <h3
        className="text-lg font-medium mb-1"
        style={{ color: 'var(--color-text)' }}
      >
        {title}
      </h3>
      {description && (
        <p
          className="text-sm mb-4 max-w-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {description}
        </p>
      )}
      {action}
    </div>
  )
}
