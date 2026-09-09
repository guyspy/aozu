import { jsonSchemaToZod, type JsonSchema } from '@aotter/mantle-spec'

export const STORYBOARD_NAMESPACE = 'aozu-storyboards'
export const STORYBOARD_LIMITS = { frames: 100, candidates: 500, imageBytes: 5 * 1024 * 1024, dimension: 4096, pixels: 16 * 1024 * 1024 }
export interface BoardImage { id: string; filename: string; sha256: string; width: number; height: number; size: number; source: string }
export interface BoardFrame {
  id: string; title: string; notes: string; candidates: string[]; selected: string | null
  review: 'draft' | 'needs-work' | 'confirmed'; transition: string; duration: number | null
  references: Array<{ imageId: string; purpose: string }>
}
export interface BoardContent { name: string; notes: string; frames: BoardFrame[] }
export interface Storyboard extends BoardContent {
  id: string; revision: number; updatedAt: number; images: BoardImage[]
  past: BoardContent[]; future: BoardContent[]
}
const str = (maxLength = 8000): JsonSchema => ({ type: 'string', maxLength })
const id: JsonSchema = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,100}$' }
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false })
export const STORYBOARD_UPDATE_SCHEMA = obj({
  boardId: id, expectedRevision: { type: 'integer', minimum: 0 },
  action: { enum: ['create', 'rename', 'add-frame', 'edit-frame', 'remove-frame', 'reorder', 'add-candidate', 'select', 'reference', 'undo', 'redo'] },
  name: str(120), notes: str(), frameId: id, title: str(160),
  order: { type: 'array', items: id, maxItems: 100, uniqueItems: true },
  imageId: id, filename: str(200), source: str(2000),
  dataUrl: { type: 'string', maxLength: 7_100_000, pattern: '^data:image/png;base64,' },
  review: { enum: ['draft', 'needs-work', 'confirmed'] }, transition: str(),
  duration: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 600 },
  purpose: str(2000), remove: { type: 'boolean' },
}, ['action'])
const validator = jsonSchemaToZod(STORYBOARD_UPDATE_SCHEMA)
export interface BoardCommand {
  action: string; boardId?: string; expectedRevision?: number; name?: string; notes?: string; frameId?: string; title?: string
  order?: string[]; imageId?: string; filename?: string; source?: string; dataUrl?: string
  review?: BoardFrame['review']; transition?: string; duration?: number | null; purpose?: string; remove?: boolean
}
export function parseBoardCommand(input: unknown): BoardCommand {
  const parsed = validator.safeParse(input)
  if (!parsed.success) throw new Error(`Invalid storyboard command: ${parsed.error.issues[0]?.message}`)
  const command = parsed.data as BoardCommand
  if (command.order && new Set(command.order).size !== command.order.length) throw new Error('Duplicate frame IDs')
  return command
}
export const boardContent = ({ name, notes, frames }: BoardContent): BoardContent => structuredClone({ name, notes, frames })
export function applyBoardCommand(board: Storyboard, command: BoardCommand, image?: BoardImage): Storyboard {
  const next = structuredClone(board)
  const previous = boardContent(board)
  const frame = next.frames.find(({ id }) => id === command.frameId)
  const requireFrame = () => { if (!frame) throw new Error('Frame not found'); return frame }
  const imageExists = (imageId?: string) => { if (!imageId || !next.images.some(({ id }) => id === imageId)) throw new Error('Image not found'); return imageId }
  switch (command.action) {
    case 'rename':
      if (command.name !== undefined) { if (!command.name.trim()) throw new Error('Name is required'); next.name = command.name.trim() }
      if (command.notes !== undefined) next.notes = command.notes
      break
    case 'add-frame':
      if (next.frames.length >= STORYBOARD_LIMITS.frames) throw new Error('Frame limit reached')
      next.frames.push({ id: crypto.randomUUID(), title: command.title?.trim() || `Frame ${next.frames.length + 1}`, notes: command.notes ?? '', candidates: [], selected: null, review: 'draft', transition: '', duration: null, references: [] })
      break
    case 'edit-frame': {
      const f = requireFrame()
      if (command.title !== undefined) { if (!command.title.trim()) throw new Error('Title is required'); f.title = command.title.trim() }
      if (command.notes !== undefined) f.notes = command.notes
      if (command.transition !== undefined) f.transition = command.transition
      if (command.duration !== undefined) f.duration = command.duration
      if (command.review !== undefined) { if (command.review === 'confirmed' && !f.selected) throw new Error('Select an image before confirming'); f.review = command.review }
      break
    }
    case 'remove-frame': next.frames = next.frames.filter(({ id }) => id !== requireFrame().id); break
    case 'reorder':
      if (!command.order || command.order.length !== next.frames.length || new Set(command.order).size !== next.frames.length || command.order.some((id) => !next.frames.some((f) => f.id === id))) throw new Error('Order must include every frame exactly once')
      next.frames = command.order.map((id) => next.frames.find((f) => f.id === id)!); break
    case 'add-candidate': {
      const f = requireFrame()
      if (!image) throw new Error('PNG image is required')
      if (next.images.length >= STORYBOARD_LIMITS.candidates) throw new Error('Candidate limit reached')
      next.images.push(image); f.candidates.push(image.id)
      // A candidate is never a selection, including the first upload.
      break
    }
    case 'select': {
      const f = requireFrame(), selected = imageExists(command.imageId)
      if (!f.candidates.includes(selected)) throw new Error('Image is not a candidate for this frame')
      if (f.selected !== selected) { f.selected = selected; f.review = 'draft' }
      break
    }
    case 'reference': {
      const f = requireFrame(), imageId = imageExists(command.imageId)
      f.references = f.references.filter((reference) => reference.imageId !== imageId)
      if (!command.remove) {
        if (!command.purpose?.trim()) throw new Error('Reference purpose is required')
        f.references.push({ imageId, purpose: command.purpose.trim() })
      }
      break
    }
    case 'undo': {
      const value = next.past.pop(); if (!value) throw new Error('Nothing to undo')
      next.future.push(previous); Object.assign(next, value); return next
    }
    case 'redo': {
      const value = next.future.pop(); if (!value) throw new Error('Nothing to redo')
      next.past.push(previous); Object.assign(next, value); return next
    }
    default: throw new Error('Unsupported storyboard action')
  }
  if (JSON.stringify(previous) !== JSON.stringify(boardContent(next))) {
    // ponytail: 30 full-content snapshots capped at 7 MiB; use patches only if real boards outgrow this.
    next.past.push(previous); next.past = next.past.slice(-30); next.future = []
  }
  return next
}

const referenceSchema = obj({ imageId: id, purpose: str(2000) }, ['imageId', 'purpose'])
const frameSchema = obj({
  id, title: str(160), notes: str(), candidates: { type: 'array', items: id, maxItems: 500, uniqueItems: true },
  selected: { anyOf: [id, { type: 'null' }] }, review: { enum: ['draft', 'needs-work', 'confirmed'] },
  transition: str(), duration: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 600 },
  references: { type: 'array', items: referenceSchema, maxItems: 500 },
}, ['id', 'title', 'notes', 'candidates', 'selected', 'review', 'transition', 'duration', 'references'])
const contentProperties = { name: str(120), notes: str(), frames: { type: 'array', items: frameSchema, maxItems: 100 } } satisfies Record<string, JsonSchema>
const contentSchema = obj(contentProperties, ['name', 'notes', 'frames'])
const boardValidator = jsonSchemaToZod(obj({
  ...contentProperties, id, revision: { type: 'integer', minimum: 1 }, updatedAt: { type: 'integer', minimum: 0 },
  images: { type: 'array', maxItems: 500, items: obj({ id, filename: str(200), source: str(2000), sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, width: { type: 'integer', minimum: 1, maximum: 4096 }, height: { type: 'integer', minimum: 1, maximum: 4096 }, size: { type: 'integer', minimum: 1, maximum: 5242880 } }, ['id', 'filename', 'source', 'sha256', 'width', 'height', 'size']) },
  past: { type: 'array', maxItems: 30, items: contentSchema }, future: { type: 'array', maxItems: 30, items: contentSchema },
}, ['id', 'revision', 'updatedAt', 'name', 'notes', 'frames', 'images', 'past', 'future']))
export function validateStoryboard(value: unknown): Storyboard {
  const result = boardValidator.safeParse(value)
  if (!result.success) throw new Error(`Invalid storyboard: ${result.error.issues[0]?.message}`)
  const board = result.data as Storyboard
  if (new TextEncoder().encode(JSON.stringify(board)).byteLength > 7 * 1024 * 1024) throw new Error('Storyboard metadata exceeds 7 MiB; shorten notes or reference lists')
  if (board.images.reduce((sum, image) => sum + image.size, 0) > 128 * 1024 * 1024) throw new Error('Board images exceed 128 MiB')
  const ids = new Set(board.images.map(({ id }) => id))
  if (!board.name.trim() || ids.size !== board.images.length) throw new Error('Invalid board name or duplicate images')
  for (const content of [board, ...board.past, ...board.future]) {
    if (!content.name.trim()) throw new Error('Invalid board name')
    if (new Set(content.frames.map(({ id }) => id)).size !== content.frames.length) throw new Error('Duplicate frames')
    for (const frame of content.frames) {
      if (new Set(frame.candidates).size !== frame.candidates.length || !frame.title.trim() || frame.candidates.some((id) => !ids.has(id)) || (frame.selected && !frame.candidates.includes(frame.selected)) || frame.references.some(({ imageId, purpose }) => !ids.has(imageId) || !purpose.trim()) || new Set(frame.references.map((r) => r.imageId)).size !== frame.references.length || (frame.review === 'confirmed' && !frame.selected)) throw new Error('Invalid frame image reference')
    }
  }
  return board
}
