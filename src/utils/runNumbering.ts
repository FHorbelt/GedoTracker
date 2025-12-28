/**
 * Extract the numeric suffix from a run name and increment it
 * E.g., "A252_Auf_Scan 01" -> "A252_Auf_Scan 02"
 */
export function incrementRunName(previousName: string): string {
  // Match pattern: any prefix followed by a number at the end
  const match = previousName.match(/^(.+?)\s*(\d+)$/)
  
  if (match) {
    const prefix = match[1]
    const number = parseInt(match[2])
    const paddedNumber = (number + 1).toString().padStart(match[2].length, '0')
    return `${prefix} ${paddedNumber}`
  }
  
  // If no number found, append " 01"
  return `${previousName} 01`
}

/**
 * Generate initial run name suggestion
 */
export function generateInitialRunName(_projectNumber: string): string {
  return 'Scan 01'
}

/**
 * Validate run name format
 */
export function isValidRunName(name: string): boolean {
  return name.trim().length > 0
}
