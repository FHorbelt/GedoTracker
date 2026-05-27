import { db } from '../db/database'
import { FixedPoint, BoundingBox } from '../db/models'

const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// Zoom levels to cache (14-17 is a good range for field work - balances detail vs storage)
const CACHE_ZOOM_LEVELS = [14, 15, 16, 17]

export interface TileCacheProgress {
  total: number
  downloaded: number
  failed: number
  status: 'idle' | 'downloading' | 'completed' | 'error'
}

/**
 * Calculate bounding box from fixed points with buffer in meters
 */
export function calculateBoundingBox(points: FixedPoint[], bufferMeters: number = 100): BoundingBox {
  if (points.length === 0) {
    throw new Error('No points provided')
  }

  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity

  for (const point of points) {
    minLat = Math.min(minLat, point.latitude)
    maxLat = Math.max(maxLat, point.latitude)
    minLon = Math.min(minLon, point.longitude)
    maxLon = Math.max(maxLon, point.longitude)
  }

  // Add buffer (approximate meters to degrees)
  // 1 degree latitude ≈ 111km
  // 1 degree longitude ≈ 111km * cos(latitude)
  const latBuffer = bufferMeters / 111000
  const avgLat = (minLat + maxLat) / 2
  const lonBuffer = bufferMeters / (111000 * Math.cos(avgLat * Math.PI / 180))

  return {
    minLat: minLat - latBuffer,
    maxLat: maxLat + latBuffer,
    minLon: minLon - lonBuffer,
    maxLon: maxLon + lonBuffer
  }
}

/**
 * Convert lat/lon to tile coordinates
 */
function latLonToTile(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom)
  const x = Math.floor((lon + 180) / 360 * n)
  const latRad = lat * Math.PI / 180
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n)
  return { x, y }
}

/**
 * Get all tile coordinates within a bounding box for a zoom level
 */
function getTilesInBoundingBox(bbox: BoundingBox, zoom: number): Array<{ x: number; y: number; z: number }> {
  const tiles: Array<{ x: number; y: number; z: number }> = []

  const topLeft = latLonToTile(bbox.maxLat, bbox.minLon, zoom)
  const bottomRight = latLonToTile(bbox.minLat, bbox.maxLon, zoom)

  for (let x = topLeft.x; x <= bottomRight.x; x++) {
    for (let y = topLeft.y; y <= bottomRight.y; y++) {
      tiles.push({ x, y, z: zoom })
    }
  }

  return tiles
}

/**
 * Generate tile URL
 */
function getTileUrl(x: number, y: number, z: number): string {
  return TILE_URL.replace('{x}', x.toString()).replace('{y}', y.toString()).replace('{z}', z.toString())
}

/**
 * Generate cache key for a tile
 */
function getTileCacheKey(fieldId: string, x: number, y: number, z: number): string {
  return `${fieldId}/${z}/${x}/${y}`
}

/**
 * Download and cache tiles for a fixed point field
 */
export async function downloadTilesForField(
  fieldId: string,
  points: FixedPoint[],
  onProgress?: (progress: TileCacheProgress) => void
): Promise<TileCacheProgress> {
  const progress: TileCacheProgress = {
    total: 0,
    downloaded: 0,
    failed: 0,
    status: 'downloading'
  }

  try {
    const bbox = calculateBoundingBox(points, 100)

    // Get all tiles needed
    const allTiles: Array<{ x: number; y: number; z: number }> = []
    for (const zoom of CACHE_ZOOM_LEVELS) {
      allTiles.push(...getTilesInBoundingBox(bbox, zoom))
    }

    progress.total = allTiles.length
    onProgress?.(progress)

    // Download tiles in batches
    const BATCH_SIZE = 10
    for (let i = 0; i < allTiles.length; i += BATCH_SIZE) {
      const batch = allTiles.slice(i, i + BATCH_SIZE)

      await Promise.all(batch.map(async (tile) => {
        try {
          const url = getTileUrl(tile.x, tile.y, tile.z)
          const response = await fetch(url)

          if (response.ok) {
            const blob = await response.blob()
            const cacheKey = getTileCacheKey(fieldId, tile.x, tile.y, tile.z)

            // Store in IndexedDB
            await db.mapTiles.put({
              id: cacheKey,
              fieldId,
              z: tile.z,
              x: tile.x,
              y: tile.y,
              blob,
              timestamp: Date.now()
            })

            progress.downloaded++
          } else {
            progress.failed++
          }
        } catch (error) {
          console.error('Failed to download tile:', error)
          progress.failed++
        }
      }))

      onProgress?.(progress)
    }

    progress.status = 'completed'
    onProgress?.(progress)

    // Update field with cache info
    const field = await db.fixedPointFields.get(fieldId)
    if (field) {
      await db.fixedPointFields.update(fieldId, {
        ...field,
        tileCacheInfo: {
          bbox,
          tileCount: progress.downloaded,
          cachedAt: Date.now()
        }
      })
    }

    return progress
  } catch (error) {
    console.error('Error downloading tiles:', error)
    progress.status = 'error'
    onProgress?.(progress)
    return progress
  }
}

/**
 * Get a cached tile as blob URL
 */
export async function getCachedTile(fieldId: string, x: number, y: number, z: number): Promise<string | null> {
  try {
    const cacheKey = getTileCacheKey(fieldId, x, y, z)
    const cached = await db.mapTiles.get(cacheKey)

    if (cached) {
      return URL.createObjectURL(cached.blob)
    }
    return null
  } catch (error) {
    console.error('Error getting cached tile:', error)
    return null
  }
}

/**
 * Check if tiles are cached for a field
 */
export async function hasCachedTiles(fieldId: string): Promise<boolean> {
  try {
    const count = await db.mapTiles.where('fieldId').equals(fieldId).count()
    return count > 0
  } catch (error) {
    return false
  }
}

/**
 * Delete cached tiles for a field
 */
export async function deleteCachedTiles(fieldId: string): Promise<void> {
  try {
    await db.mapTiles.where('fieldId').equals(fieldId).delete()
  } catch (error) {
    console.error('Error deleting cached tiles:', error)
  }
}

/**
 * Get cache statistics for a field
 */
export async function getCacheStats(fieldId: string): Promise<{ count: number; sizeBytes: number } | null> {
  try {
    const tiles = await db.mapTiles.where('fieldId').equals(fieldId).toArray()
    const count = tiles.length
    const sizeBytes = tiles.reduce((sum, tile) => sum + tile.blob.size, 0)
    return { count, sizeBytes }
  } catch (error) {
    return null
  }
}

/**
 * Estimate how many tiles would be downloaded for a field
 */
export function estimateTileCount(points: FixedPoint[]): number {
  if (points.length === 0) return 0

  const bbox = calculateBoundingBox(points, 100)
  let total = 0

  for (const zoom of CACHE_ZOOM_LEVELS) {
    const tiles = getTilesInBoundingBox(bbox, zoom)
    total += tiles.length
  }

  return total
}
