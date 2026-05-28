import type { TargetBoardInfo } from '../db/models'

export interface TargetBoardPreset {
  id: string
  image: string
  label: string
  board: TargetBoardInfo
}

export const TARGET_BOARD_PRESETS: TargetBoardPreset[] = [
  { id: 'preset-100-3',   image: '/targets/target-100-3.png',   label: '100mm / 3mm',  board: { size: '100', height: -6,  thickness: 3  } },
  { id: 'preset-200-3',   image: '/targets/target-200-3.png',   label: '200mm / 3mm',  board: { size: '200', height: -6,  thickness: 3  } },
  { id: 'preset-boden-200', image: '/targets/boden-100-200.png', label: 'Boden 200mm', board: { size: '100', height: 200, thickness: 0  } },
  { id: 'preset-100-60',  image: '/targets/target-100-60.png',  label: '100mm / 60mm', board: { size: '100', height: -6,  thickness: 60 } },
  { id: 'preset-200-60',  image: '/targets/target-200-60.png',  label: '200mm / 60mm', board: { size: '200', height: -6,  thickness: 60 } },
  { id: 'preset-boden-400', image: '/targets/boden-100-400.png', label: 'Boden 400mm', board: { size: '100', height: 400, thickness: 0  } },
]

export const DEFAULT_QUICK_SELECT_TARGET_IDS: string[] = TARGET_BOARD_PRESETS.map(p => p.id)

export const MIN_QUICK_SELECT_TARGETS = 2
export const MAX_QUICK_SELECT_TARGETS = 6
