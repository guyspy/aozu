/** A collection groups Characters and provides shared world context, without changing their own profiles. */
export const CHARACTER_COLLECTIONS = 'character-collections'
export const DEFAULT_CHARACTER_COLLECTION = 'default'

export interface CharacterCollectionProfile {
  name: string
  description: string
  backstory: string
}

export interface CharacterCollection extends CharacterCollectionProfile {
  id: string
  characterIds: string[]
  version: number
  updatedAt: number
}

export function characterCollectionName(value: string): string {
  const name = value.trim()
  if (!name || name.length > 100) throw new Error('Collection name must contain 1–100 characters')
  return name
}

export function characterCollectionProfile(value: CharacterCollectionProfile): CharacterCollectionProfile {
  if (typeof value.name !== 'string' || typeof value.description !== 'string' || typeof value.backstory !== 'string' ||
    value.description.length > 500 || value.backstory.length > 8000) throw new Error('Invalid Collection profile')
  return { name: characterCollectionName(value.name), description: value.description.trim(), backstory: value.backstory.trim() }
}
