import type { JsonSchema, ManifestSource } from '@aotter/mantle-spec'
import { CHARACTER_ALIGN_MODES, CHARACTER_OUTFIT_SLOTS, CHARACTER_REFERENCE_KINDS, CHARACTER_REFERENCE_VIEWS, CHARACTER_RESIZE_MODES, CHARACTER_RIG, CHARACTER_VARIANT_GROUPS } from '../domain/character.ts'
import { MAX_REFERENCE_BYTES, MAX_REFERENCE_DIMENSION } from '../application/character-model-sheet.ts'
import { CHARACTER_NAVIGATION_GUIDANCE } from '../application/character-agent-guidance.ts'
import { CHARACTER_REPLACE_ASSET_TOOL_GUIDANCE, CHARACTER_VARIANT_METADATA_TOOL_GUIDANCE } from '../application/character-asset-policy.ts'
import { envelope, objectSchema, PNG_WEBMCP_TRANSFER_GUIDANCE, pngPayloadProperties, source, toolEffectsSchema, toolResultSchema } from './backbone-shared.ts'

const characterHistoryResultSchema = objectSchema({
  status: { enum: ['ok', 'no_active_history', 'not_settled', 'revision_conflict', 'nothing_to_undo', 'nothing_to_redo'] },
  data: { type: 'object' },
  effects: toolEffectsSchema,
}, ['status', 'data'])

const characterHistoryInputSchema = objectSchema({
  characterId: { type: 'string', minLength: 1 },
  expectedRevision: { type: 'integer', minimum: 0 },
}, ['characterId', 'expectedRevision'])

const characterTransformSchema = objectSchema({
  x: { type: 'number', minimum: -512, maximum: 512 },
  y: { type: 'number', minimum: -768, maximum: 768 },
  scale: { type: 'number', minimum: 0.25, maximum: 4 },
}, ['x', 'y', 'scale'])

const characterNormalizationSchema = objectSchema({
  resize: { enum: CHARACTER_RESIZE_MODES },
  align: { enum: CHARACTER_ALIGN_MODES },
}, ['resize', 'align'])

const characterAlignmentPointsSchema = {
  type: 'array', minItems: 3, maxItems: 12, items: objectSchema({
    label: { type: 'string', minLength: 1, maxLength: 80 },
    reference: objectSchema({ x: { type: 'number', minimum: 0, maximum: 512 }, y: { type: 'number', minimum: 0, maximum: 768 } }, ['x', 'y']),
    candidate: objectSchema({ x: { type: 'number', minimum: 0, maximum: 512 }, y: { type: 'number', minimum: 0, maximum: 768 } }, ['x', 'y']),
  }, ['label', 'reference', 'candidate']),
} satisfies JsonSchema
const characterPreflightPointsSchema = objectSchema({
  referenceSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  points: characterAlignmentPointsSchema,
}, ['referenceSha256', 'points'])

const characterInspectionSchema = objectSchema({
  width: { const: CHARACTER_RIG.canvas.width },
  height: { const: CHARACTER_RIG.canvas.height },
  hasTransparentPixels: { const: true },
  hasVisiblePixels: { const: true },
  genuineRgba: { const: true },
  visibleBounds: objectSchema({
    x: { type: 'integer', minimum: 0 },
    y: { type: 'integer', minimum: 0 },
    width: { type: 'integer', minimum: 1, maximum: CHARACTER_RIG.canvas.width },
    height: { type: 'integer', minimum: 1, maximum: CHARACTER_RIG.canvas.height },
  }, ['x', 'y', 'width', 'height']),
  visiblePixelCount: { type: 'integer', minimum: 1 },
  size: { type: 'integer', minimum: 1, maximum: 5 * 1024 * 1024 },
  sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
}, ['width', 'height', 'hasTransparentPixels', 'hasVisiblePixels', 'genuineRgba', 'size', 'sha256'])

const characterAssetDescriptor = (inspection: JsonSchema) => objectSchema({
  blobId: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  filename: { type: 'string', minLength: 1, maxLength: 200 },
  source: { enum: ['user', 'agent', 'starter'] },
  inspection,
  canonicalSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
}, ['blobId', 'filename', 'source', 'inspection'])
const characterAssetDescriptorSchema = characterAssetDescriptor(characterInspectionSchema)
const referenceInspectionSchema = objectSchema({
  ...characterInspectionSchema.properties,
  width: { type: 'integer', minimum: 1, maximum: MAX_REFERENCE_DIMENSION },
  height: { type: 'integer', minimum: 1, maximum: MAX_REFERENCE_DIMENSION },
  size: { type: 'integer', minimum: 1, maximum: MAX_REFERENCE_BYTES },
  hasTransparentPixels: { type: 'boolean' },
  genuineRgba: { type: 'boolean' },
  visibleBounds: objectSchema({
    x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 },
    width: { type: 'integer', minimum: 1, maximum: MAX_REFERENCE_DIMENSION },
    height: { type: 'integer', minimum: 1, maximum: MAX_REFERENCE_DIMENSION },
  }, ['x', 'y', 'width', 'height']),
}, ['width', 'height', 'hasTransparentPixels', 'hasVisiblePixels', 'genuineRgba', 'size', 'sha256'])
const referenceGuidesSchema = objectSchema({
  head: { type: 'number', minimum: 0, maximum: 1 },
  feet: { type: 'number', minimum: 0, maximum: 1 },
}, ['head', 'feet'])
const referenceMetadataProperties = {
  label: { type: 'string', minLength: 1, maxLength: 80 },
  kind: { enum: CHARACTER_REFERENCE_KINDS },
  viewpoint: { type: 'string', minLength: 1, maxLength: 80 },
  pose: { type: 'string', minLength: 1, maxLength: 80 },
  sourceSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  needsReview: { type: 'boolean' },
} satisfies Record<string, JsonSchema>
const referenceIdSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' } as const
const referenceSchema = objectSchema({
  asset: characterAssetDescriptor(referenceInspectionSchema),
  ...referenceMetadataProperties,
  notes: { type: 'string', maxLength: 1000 },
  guides: referenceGuidesSchema,
  fromAppearance: { type: 'boolean' },
}, ['asset'])
const referenceSetProperties = {
  views: objectSchema(Object.fromEntries(CHARACTER_REFERENCE_VIEWS.map((view) => [view, referenceSchema]))),
  references: { type: 'object', maxProperties: 100, additionalProperties: referenceSchema },
} satisfies Record<string, JsonSchema>
const modelSheetSchema = objectSchema({
  heightCm: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
  ...referenceSetProperties,
}, ['views'])
const characterSelectionSchema = objectSchema({
  expression: { type: 'string', minLength: 1, maxLength: 40 },
  outfits: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 40 } },
  hair: { type: 'string', minLength: 1, maxLength: 40 },
  headwear: { type: 'string', minLength: 1, maxLength: 40 },
  props: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 40 } },
}, ['outfits', 'props'])

const characterAttributesSchema: JsonSchema = {
  type: 'object',
  maxProperties: 32,
  additionalProperties: { type: ['string', 'number', 'boolean'], maxLength: 200 },
}

export const characterWorkspaceProperties = {
  schemaVersion: { const: 6 },
  packId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' },
  rigProfile: objectSchema({
    id: { const: CHARACTER_RIG.id },
    version: { const: CHARACTER_RIG.version },
  }, ['id', 'version']),
  name: { type: 'string', minLength: 1, maxLength: 200 },
  description: { type: 'string', maxLength: 500 },
  backstory: { type: 'string', maxLength: 8_000 },
  attributes: characterAttributesSchema,
  modelSheet: modelSheetSchema,
  activeAppearanceId: referenceIdSchema,
  appearances: { type: 'array', maxItems: 100, items: objectSchema({
    id: referenceIdSchema,
    label: { type: 'string', minLength: 1, maxLength: 80 },
    selected: characterSelectionSchema,
    modelSheet: objectSchema(referenceSetProperties, ['views']),
  }, ['id', 'label', 'selected']) },
  faceStyles: { type: 'array', minItems: 1, maxItems: 100, items: objectSchema({
    id: referenceIdSchema,
    label: { type: 'string', minLength: 1, maxLength: 80 },
    description: { type: 'string', maxLength: 500 },
    tags: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 40 } },
    facialHair: { oneOf: [{ type: 'null' }, objectSchema({
      type: { type: 'string', minLength: 1, maxLength: 80 }, length: { type: 'string', maxLength: 80 }, density: { type: 'string', maxLength: 80 }, color: { type: 'string', maxLength: 80 },
    }, ['type'])] },
  }, ['id', 'label', 'facialHair']) },
  variants: {
    type: 'array',
    minItems: 1,
    maxItems: 100,
    items: objectSchema({
      id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
      group: { enum: CHARACTER_VARIANT_GROUPS },
      label: { type: 'string', minLength: 1, maxLength: 80 },
      metadata: objectSchema({
        description: { type: 'string', maxLength: 500 },
        tags: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 40 } },
        sourceSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        outfit: objectSchema({ slot: { enum: CHARACTER_OUTFIT_SLOTS }, garmentType: { type: 'string', minLength: 1, maxLength: 80 } }, ['slot', 'garmentType']),
        faceStyleId: referenceIdSchema,
      }),
      layers: objectSchema({
        body: characterAssetDescriptorSchema,
        head: characterAssetDescriptorSchema,
        back: characterAssetDescriptorSchema,
        front: characterAssetDescriptorSchema,
      }),
      transform: characterTransformSchema,
    }, ['id', 'group', 'label', 'layers']),
  },
  headRegistration: objectSchema({ variantId: { type: 'string', minLength: 1, maxLength: 40 } }, ['variantId']),
  selected: characterSelectionSchema,
}
export const characterWorkspaceRequired = ['schemaVersion', 'packId', 'rigProfile', 'name', 'variants', 'faceStyles', 'selected']

export const CHARACTER_BACKBONE_SOURCES = [
  source(
    'authoring/inspect-character-contract.yaml',
    envelope('Procedure', 'inspect-character-contract', {
      title: 'Inspect Character Contract',
      description: `Inspect the exact target before edits. Read authoringGuide once; follow workflow, metadataStatus, generationGuidance, coverageContract and review feedback. The declared group and outfit.slot select AOZU-owned coverage rules; agents never invent percentages. scope:appearance returns source images, hashes and overlap diagnostics. Optional candidate performs the same PNG normalization, RGBA, coverage and safety checks without storing it; view previewDataUrl, and supply candidate.preflightPoints when attachment points are observable. Optional alignmentPoints rechecks a stored asset. scope:model-sheet with images requests original references. Refresh after edits. Stored and visually verified are distinct.`,
      input: {
        ...objectSchema({
          characterId: { type: 'string', minLength: 1 },
          group: { enum: CHARACTER_VARIANT_GROUPS },
          variantId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
          layer: { enum: ['body', 'head', 'back', 'front'] },
          scope: { enum: ['appearance', 'model-sheet'] },
          alignmentPoints: objectSchema({
            expectedRevision: { type: 'integer', minimum: 0 },
            assetSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
            referenceSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
            points: characterAlignmentPointsSchema,
          }, ['expectedRevision', 'assetSha256', 'referenceSha256', 'points']),
          candidate: objectSchema({
            filename: { type: 'string', minLength: 1, maxLength: 200 },
            ...pngPayloadProperties,
            normalization: characterNormalizationSchema,
            rebaseDerivedAssets: { type: 'boolean' },
            preflightPoints: characterPreflightPointsSchema,
          }, ['filename', 'dataUrl']),
          referenceId: referenceIdSchema,
          ...referenceMetadataProperties,
          images: { type: 'array', maxItems: 5, uniqueItems: true, items: referenceIdSchema },
        }, ['characterId']),
        readOnly: true,
      },
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.inspect-character-contract' },
    }),
  ),
  source(
    'authoring/inspect-character-contract-mcp.yaml',
    envelope('Trigger', 'inspect-character-contract', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'inspect-character-contract' },
    }),
  ),
  source(
    'authoring/update-character-profile.yaml',
    envelope('Procedure', 'update-character-profile', {
      title: 'Update Character Profile',
      description: `Update one or more identity fields of a Character using its exact revision. The current unsaved workshop uses characterId new and revision 0; its first edit creates a saved Character and returns its permanent ID. heightCm is an optional shared character height in cm; null clears it. Leave it unset for unknown or variable size. Use this field, not a custom attribute. Omitted fields stay unchanged; empty description, backstory, or attributes clear that field. A successful call saves the profile and opens the Character profile tab with its current Appearance. Profile edits are outside Appearance Undo/Redo. Finish local unsaved input first. ${CHARACTER_NAVIGATION_GUIDANCE}`,
      input: objectSchema({
        characterId: { type: 'string', minLength: 1 },
        expectedRevision: { type: 'integer', minimum: 0 },
        name: { type: 'string', minLength: 1, maxLength: 80 },
        description: { type: 'string', maxLength: 500 },
        backstory: { type: 'string', maxLength: 8_000 },
        attributes: characterAttributesSchema,
        heightCm: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 100_000 },
      }, ['characterId', 'expectedRevision']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.update-character-profile' },
    }),
  ),
  source(
    'authoring/update-character-profile-mcp.yaml',
    envelope('Trigger', 'update-character-profile', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'update-character-profile' },
    }),
  ),
  source(
    'authoring/update-character-variant-metadata.yaml',
    envelope('Procedure', 'update-character-variant-metadata', {
      title: 'Create or Update Character Variant',
      description: CHARACTER_VARIANT_METADATA_TOOL_GUIDANCE,
      input: objectSchema({
        characterId: { type: 'string', minLength: 1 },
        expectedRevision: { type: 'integer', minimum: 0 },
        group: { enum: CHARACTER_VARIANT_GROUPS },
        variantId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
        label: { type: 'string', minLength: 1, maxLength: 80 },
        description: { type: 'string', maxLength: 500 },
        tags: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 40 } },
        sourceSha256: { type: ['string', 'null'], pattern: '^[0-9a-f]{64}$' },
        outfit: objectSchema({ slot: { enum: CHARACTER_OUTFIT_SLOTS }, garmentType: { type: 'string', minLength: 1, maxLength: 80 } }, ['slot', 'garmentType']),
        faceStyleId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
        faceStyle: objectSchema({
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' }, label: { type: 'string', minLength: 1, maxLength: 80 },
          description: { type: 'string', maxLength: 500 }, tags: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 40 } },
          facialHair: { oneOf: [{ type: 'null' }, objectSchema({ type: { type: 'string', minLength: 1, maxLength: 80 }, length: { type: 'string', maxLength: 80 }, density: { type: 'string', maxLength: 80 }, color: { type: 'string', maxLength: 80 } }, ['type'])] },
        }, ['id', 'label']),
      }, ['characterId', 'expectedRevision', 'group', 'variantId']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.update-character-variant-metadata' },
    }),
  ),
  source(
    'authoring/update-character-variant-metadata-mcp.yaml',
    envelope('Trigger', 'update-character-variant-metadata', { source: { kind: 'mcp', surface: 'public' }, target: { procedure: 'update-character-variant-metadata' } }),
  ),
  source(
    'authoring/update-character-model-sheet.yaml',
    envelope('Procedure', 'update-character-model-sheet', {
      title: 'Update Character Model Sheet',
      description: `${PNG_WEBMCP_TRANSFER_GUIDANCE} Edit the active Appearance’s model sheet after inspect_character_contract with scope:model-sheet. References belong to modelSheet.appearanceId; switch saved sets through set_character_variant_selection, then re-inspect. Composition edits autosave into the current Appearance and synchronize linked front images. Other references may have needsReview:true; visually compare against the updated Appearance, then replace them or set needsReview:false. This is a consistency flag, not user approval. Optional shared height is edited through update_character_profile. Use referenceId for one image: front/three-quarter/side/back are the default turnaround slots; other IDs create supplemental references with label and kind. view is a compatibility alias for a default slot. Optional viewpoint and pose describe that reference. PNGs may be opaque and keep original dimensions up to 4096 × 4096 / 5 MiB. For replacement supply filename, exact expectedAssetSha256 (null for empty), dataUrl, and optional dataSha256. Alternatively fromAppearance:true captures the current composition into front with its source hash; do not supply image input or filename. sourceSha256 identifies the source image used for generated art. remove:true deletes only this reference and requires its exact hash. All edits use expectedRevision. Replacement clears old guides and source hash unless a new source is supplied. Notes and guides need existing art; guides are original-image y fractions from the top with head above feet, excluding hats, raised arms and props. Never infer height from pixels; null clears guides. Omitted fields remain unchanged. accepted:true means stored, not visually verified or user-approved. Follow visualReview on the exact reference. ${CHARACTER_NAVIGATION_GUIDANCE}`,
      input: objectSchema({
        characterId: { type: 'string', minLength: 1 },
        expectedRevision: { type: 'integer', minimum: 0 },
        view: { enum: CHARACTER_REFERENCE_VIEWS },
        referenceId: referenceIdSchema,
        ...referenceMetadataProperties,
        fromAppearance: { type: 'boolean' },
        remove: { type: 'boolean' },
        notes: { type: 'string', maxLength: 1000 },
        guides: { oneOf: [{ type: 'null' }, referenceGuidesSchema] },
        ...pngPayloadProperties,
        filename: { type: 'string', minLength: 1, maxLength: 200 },
        expectedAssetSha256: { type: ['string', 'null'], pattern: '^[0-9a-f]{64}$' },
      }, ['characterId', 'expectedRevision']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.update-character-model-sheet' },
    }),
  ),
  source(
    'authoring/update-character-model-sheet-mcp.yaml',
    envelope('Trigger', 'update-character-model-sheet', {
      source: { kind: 'mcp', surface: 'public' }, target: { procedure: 'update-character-model-sheet' },
    }),
  ),
  source(
    'authoring/replace-character-asset.yaml',
    envelope('Procedure', 'replace-character-asset', {
      title: 'Replace Character Asset',
      description: `${PNG_WEBMCP_TRANSFER_GUIDANCE} ${CHARACTER_REPLACE_ASSET_TOOL_GUIDANCE}`,
      input: objectSchema({
        characterId: { type: 'string', minLength: 1 },
        group: { enum: CHARACTER_VARIANT_GROUPS },
        variantId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
        label: { type: 'string', minLength: 1, maxLength: 80 },
        layer: { enum: ['body', 'head', 'back', 'front'] },
        expectedRevision: { type: 'integer', minimum: 0 },
        expectedAssetSha256: { type: ['string', 'null'], pattern: '^[0-9a-f]{64}$' },
        filename: { type: 'string', minLength: 1, maxLength: 200 },
        ...pngPayloadProperties,
        normalization: characterNormalizationSchema,
        rebaseDerivedAssets: { type: 'boolean' },
        preflightPoints: characterPreflightPointsSchema,
      }, ['characterId', 'group', 'variantId', 'label', 'layer', 'expectedRevision', 'expectedAssetSha256', 'filename', 'dataUrl']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.replace-character-asset' },
    }),
  ),
  source(
    'authoring/replace-character-asset-mcp.yaml',
    envelope('Trigger', 'replace-character-asset', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'replace-character-asset' },
    }),
  ),
  source(
    'authoring/repair-character-asset.yaml',
    envelope('Procedure', 'repair-character-asset', {
      title: 'Repair Character Asset',
      description: `${PNG_WEBMCP_TRANSFER_GUIDANCE} Repair one existing expression after inspect_character_contract and its backgroundPreparation workflow. The current head asset and editable-region mask are the only edit source; this tool never falls back to the canonical body. Accepted pixels are deterministically stitched into that current asset, preserving protected pixels. Supply one complete dataUrl and optional dataSha256. Outfits and other replacement-only target layers must use replace_character_asset. After acceptance, follow the returned alignment.visualReview through all four browser modes before the next asset. ${CHARACTER_NAVIGATION_GUIDANCE}`,
      input: objectSchema({
        characterId: { type: 'string', minLength: 1 },
        group: { const: 'expression' },
        variantId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
        label: { type: 'string', minLength: 1, maxLength: 80 },
        layer: { const: 'head' },
        expectedRevision: { type: 'integer', minimum: 0 },
        expectedAssetSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        filename: { type: 'string', minLength: 1, maxLength: 200 },
        ...pngPayloadProperties,
        normalization: characterNormalizationSchema,
      }, ['characterId', 'group', 'variantId', 'label', 'layer', 'expectedRevision', 'expectedAssetSha256', 'filename', 'dataUrl']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.repair-character-asset' },
    }),
  ),
  source(
    'authoring/repair-character-asset-mcp.yaml',
    envelope('Trigger', 'repair-character-asset', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'repair-character-asset' },
    }),
  ),
  source(
    'authoring/set-character-variant-selection.yaml',
    envelope('Procedure', 'set-character-variant-selection', {
      title: 'Set Character Variant Selection',
      description: `Activate or deactivate an existing expression, garment, hair, headwear, or prop using the inspected revision. Outfits and props are independent toggles; their selected arrays persist bottom-to-top activation order. Activating an inactive item puts it on top, activating an active item keeps its order, and deactivating then reactivating moves it to the top. Wardrobe slots are descriptive metadata and do not make garments mutually exclusive. Edits automatically save into the current named Appearance. Alternatively use appearance:{action:create|save-as|select|rename|delete,id,label?}, omitting group/variantId/active. create opens a fresh look with no selected variants and an empty model sheet. ${CHARACTER_NAVIGATION_GUIDANCE}`,
      input: objectSchema({
        characterId: { type: 'string', minLength: 1 },
        group: { enum: ['expression', 'outfit', 'hair', 'headwear', 'prop'] },
        variantId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
        expectedRevision: { type: 'integer', minimum: 0 },
        active: { type: 'boolean' },
        appearance: objectSchema({ action: { enum: ['create', 'save-as', 'select', 'rename', 'delete'] }, id: referenceIdSchema, label: { type: 'string', minLength: 1, maxLength: 80 } }, ['action', 'id']),
      }, ['characterId', 'expectedRevision']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.set-character-variant-selection' },
    }),
  ),
  source(
    'authoring/set-character-variant-selection-mcp.yaml',
    envelope('Trigger', 'set-character-variant-selection', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'set-character-variant-selection' },
    }),
  ),
  source(
    'authoring/set-character-variant-transform.yaml',
    envelope('Procedure', 'set-character-variant-transform', {
      title: 'Set Character Variant Transform',
      description: `Visually align an existing expression whole head or registered overlay by changing only its full-canvas translation and uniform scale. Inspect first; x moves right, y moves down, and values are absolute. Front and back layers share one transform. Follow the returned visual review in Composite, Overlay, Difference, and Align, then return to Composite. The canonical body is locked. ${CHARACTER_NAVIGATION_GUIDANCE}`,
      input: objectSchema({
        characterId: { type: 'string', minLength: 1 },
        group: { enum: ['expression', 'outfit', 'hair', 'headwear', 'prop'] },
        variantId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
        expectedRevision: { type: 'integer', minimum: 0 },
        x: { type: 'number', minimum: -512, maximum: 512 },
        y: { type: 'number', minimum: -768, maximum: 768 },
        scale: { type: 'number', minimum: 0.25, maximum: 4 },
      }, ['characterId', 'group', 'variantId', 'expectedRevision', 'x', 'y', 'scale']),
      output: toolResultSchema,
      handler: { kind: 'ref', ref: 'companion.set-character-variant-transform' },
    }),
  ),
  source(
    'authoring/set-character-variant-transform-mcp.yaml',
    envelope('Trigger', 'set-character-variant-transform', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'set-character-variant-transform' },
    }),
  ),
  source(
    'authoring/undo-character-change.yaml',
    envelope('Procedure', 'undo-character-change', {
      title: 'Undo Character Change',
      description: `Undo the latest Appearance edit in the current session. Character profile and shared height are preserved. Switching Appearance or save-as starts a fresh undo session; navigation itself is not undoable. Shared variant art retains its shared scope. Requires the exact saved Character revision and a settled (saved) session; inactive, pending, failed, conflicted, stale, or empty-history requests return a structured status without mutation or navigation. Success persists the restored Appearance as a new Character revision and opens that Character editor. ${CHARACTER_NAVIGATION_GUIDANCE}`,
      input: characterHistoryInputSchema,
      output: characterHistoryResultSchema,
      handler: { kind: 'ref', ref: 'companion.undo-character-change' },
    }),
  ),
  source(
    'authoring/undo-character-change-mcp.yaml',
    envelope('Trigger', 'undo-character-change', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'undo-character-change' },
    }),
  ),
  source(
    'authoring/redo-character-change.yaml',
    envelope('Procedure', 'redo-character-change', {
      title: 'Redo Character Change',
      description: `Redo the most recently undone Appearance edit in the current session, preserving Character profile and shared height. Same preconditions and structured statuses as undo_character_change. Success persists the restored Appearance as a new Character revision and opens that Character editor. ${CHARACTER_NAVIGATION_GUIDANCE}`,
      input: characterHistoryInputSchema,
      output: characterHistoryResultSchema,
      handler: { kind: 'ref', ref: 'companion.redo-character-change' },
    }),
  ),
  source(
    'authoring/redo-character-change-mcp.yaml',
    envelope('Trigger', 'redo-character-change', {
      source: { kind: 'mcp', surface: 'public' },
      target: { procedure: 'redo-character-change' },
    }),
  ),
] as const satisfies readonly ManifestSource[]
