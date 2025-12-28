import { Search, X } from 'lucide-react'
import { InputHTMLAttributes, forwardRef } from 'react'

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  onClear?: () => void
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className = '', value, onClear, ...props }, ref) => {
    return (
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          ref={ref}
          type="search"
          value={value}
          className={`
            w-full pl-10 pr-10 py-2 border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400
            focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
            ${className}
          `}
          {...props}
        />
        {value && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    )
  }
)

SearchInput.displayName = 'SearchInput'
