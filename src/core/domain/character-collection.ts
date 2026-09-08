/** Library organization only; Collections do not grant experience behavior or artwork compatibility. */
export const CHARACTER_COLLECTIONS = 'character-collections'

export interface CharacterCollection {
  id: string
  name: string
  characterIds: string[]
  version: number
  updatedAt: number
}

export function characterCollectionName(value: string): string {
  const name = value.trim()
  if (!name || name.length > 100) throw new Error('Collection name must contain 1–100 characters')
  return name
}
