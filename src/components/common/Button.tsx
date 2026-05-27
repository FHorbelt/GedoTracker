import { ButtonHTMLAttributes, forwardRef } from 'react'
import { useTheme } from '../../contexts/ThemeContext'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', isLoading, children, disabled, style, ...props }, ref) => {
    const { theme } = useTheme()
    const isDark = theme === 'dark'

    const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'

    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base'
    }

    // Determine styles based on variant and theme
    const getVariantStyle = (): React.CSSProperties => {
      if (variant === 'primary') {
        if (isDark) {
          // Dark mode: transparent with blue border
          return {
            backgroundColor: 'transparent',
            color: '#3b82f6',
            border: '2px solid #3b82f6'
          }
        }
        // Light mode: filled blue
        return {
          backgroundColor: '#2563eb',
          color: 'white',
          border: '2px solid #2563eb'
        }
      }
      if (variant === 'secondary') {
        return {
          backgroundColor: isDark ? 'transparent' : 'var(--color-bg-card)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)'
        }
      }
      if (variant === 'danger') {
        if (isDark) {
          return {
            backgroundColor: 'transparent',
            color: '#ef4444',
            border: '2px solid #ef4444'
          }
        }
        return {
          backgroundColor: '#dc2626',
          color: 'white',
          border: '2px solid #dc2626'
        }
      }
      if (variant === 'ghost') {
        return {
          backgroundColor: 'transparent',
          color: 'var(--color-text)'
        }
      }
      return {}
    }

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${sizes[size]} ${className}`}
        disabled={disabled || isLoading}
        style={{ ...getVariantStyle(), ...style }}
        {...props}
      >
        {isLoading ? (
          <>
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            {children}
          </>
        ) : children}
      </button>
    )
  }
)

Button.displayName = 'Button'
