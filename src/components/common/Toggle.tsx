interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
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
        <div className={`
          w-11 h-6 rounded-full transition-colors
          ${checked ? 'bg-primary-600' : 'bg-slate-300'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}>
          <div className={`
            absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
            ${checked ? 'translate-x-5' : 'translate-x-0'}
          `} />
        </div>
      </div>
      {label && (
        <span className={`ml-3 text-sm font-medium ${disabled ? 'text-slate-400' : 'text-slate-700'}`}>
          {label}
        </span>
      )}
    </label>
  )
}
