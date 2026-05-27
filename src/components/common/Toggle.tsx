import { useTheme } from '../../contexts/ThemeContext'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const getTrackStyle = (): React.CSSProperties => {
    if (checked) {
      if (isDark) {
        return {
          backgroundColor: 'transparent',
          border: '2px solid #3b82f6'
        }
      }
      return {
        backgroundColor: '#2563eb'
      }
    }
    return {
      backgroundColor: isDark ? 'transparent' : 'var(--color-border-input)',
      border: isDark ? '2px solid var(--color-border-input)' : 'none'
    }
  }

  return (
    <label className="flex items-center cursor-pointer">
      <div className="relative">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <div
          className={`
            w-11 h-6 rounded-full transition-colors
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          style={getTrackStyle()}
        >
          <div
            className={`
              absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform
              ${checked ? 'translate-x-5' : 'translate-x-0'}
            `}
            style={{
              backgroundColor: checked && isDark ? '#3b82f6' : 'white'
            }}
          />
        </div>
      </div>
      {label && (
        <span
          className={`ml-3 text-sm font-medium ${disabled ? 'opacity-50' : ''}`}
          style={{ color: 'var(--color-text)' }}
        >
          {label}
        </span>
      )}
    </label>
  )
}
