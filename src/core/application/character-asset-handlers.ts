import { pngFromPayload, readDataUrl } from '../../adapters/webmcp/png-transfer.ts'
import { readWorkspaceView } from '../../adapters/webmcp/controller.ts'
import { MODEL_SHEET_REVIEW, characterMetadataStatus } from './character-agent-guidance.ts'
import { CHARACTER_CREATION_GROUPS, characterNormalizationContract } from './character-asset-policy.ts'
import { highConfidenceCharacterAutoFit, inspectCharacterAssetOwnership, measureCharacterMaskAlignment, measureCharacterPointAlignment, measureProtectedRegionDelta, planCharacterAlignment, planCharacterResize } from './character-alignment.ts'
import { activateCharacterVariant, characterAssetInspectionRejection, characterRegistrationFrame, isCharacterDraftAssetCurrent, resolveCharacterAssetSources, resolveCharacterDraftLayers, saveCharacterDraftAsset, setCharacterVariantTransform } from './character-creation.ts'
import { characterModelSheet, isTurnaroundView, modelSheetReferences, setModelSheetReference, updateCharacterModelSheet, validateReferenceId } from './character-model-sheet.ts'
import { inspectCharacterImage, readCharacterAlphaMask, readCharacterPixels, renderCharacterCanvasDownscale, renderStitchedCharacterEditBlob } from '../../adapters/browser/character-image.ts'
import { CHARACTER_RIG, NO_CHARACTER_NORMALIZATION, type CharacterAssetInspection, type CharacterAssetTarget, type CharacterReference, type CharacterVariantGroup, type CharacterVariantTransform } from '../domain/character.ts'
import { describeModelSheet, modelSheetPath, type CharacterAssetMutationInput, type CharacterWebMcpDependencies, type ModelSheetInput } from './character-webmcp-shared.ts'
import type { createCharacterContractHandlers } from './character-contract-handlers.ts'

type CharacterContractHandlers = ReturnType<typeof createCharacterContractHandlers>
type CharacterBounds = NonNullable<CharacterAssetInspection['visibleBounds']>
type CharacterAlignmentMeasurement = ReturnType<typeof measureCharacterMaskAlignment>
const characterReferenceBounds = (frame: ReturnType<typeof characterRegistrationFrame>, group: CharacterVariantGroup): CharacterBounds | undefined =>
  group === 'expression' ? frame.headEnvelope?.bounds : undefined

export function createCharacterAssetHandlers(dependencies: CharacterWebMcpDependencies, contracts: CharacterContractHandlers) {
  const { document, editor, activeCharacter, settledRevision, characterNextActions, characterPath, exportCharacterPng } = dependencies
  const { characterTarget, measureCharacterFit } = contracts
  async function updateModelSheet(rawInput: unknown, providedBlob?: Blob, source: 'user' | 'agent' = 'agent') {
    const input = rawInput as ModelSheetInput
    const { characterId, expectedRevision, view, referenceId = view, fromAppearance, remove, label, kind, viewpoint, pose, sourceSha256, needsReview } = input
    if (view !== undefined && (!isTurnaroundView(view) || (input.referenceId && input.referenceId !== view))) throw new Error('Use one referenceId; view is only an alias for a default turnaround slot')
    if (referenceId) validateReferenceId(referenceId)
    const hasPayload = Boolean(input.dataUrl)
    if (fromAppearance && (referenceId !== 'front' || hasPayload || providedBlob || input.filename || remove)) throw new Error('fromAppearance captures front only; omit file input and remove')
    if (remove && (hasPayload || providedBlob || input.notes !== undefined || input.guides !== undefined || label || kind || viewpoint || pose || sourceSha256 || needsReview !== undefined)) throw new Error('Remove cannot be combined with reference edits')
    const editsReference = input.notes !== undefined || input.guides !== undefined || hasPayload || providedBlob || fromAppearance || remove || label || kind || viewpoint || pose || sourceSha256 || needsReview !== undefined
    if (!editsReference) throw new Error('No model sheet changes supplied')
    if (!referenceId && editsReference) throw new Error('Choose a referenceId')
    if (readWorkspaceView(document)?.hasUncommittedInput) throw new Error('Finish or cancel local unsaved input before editing the model sheet')
    await editor.open(characterId)
    const { character, revision } = activeCharacter()
    if (revision !== expectedRevision) throw new Error('Character changed; inspect it again')
    const references = modelSheetReferences(characterModelSheet(character))
    const previous = referenceId ? references[referenceId] : undefined
    if ((hasPayload || providedBlob || fromAppearance || remove) && input.expectedAssetSha256 !== (previous?.asset.inspection.sha256 ?? null)) throw new Error('Reference changed; inspect its current hash again')
    if (referenceId && !isTurnaroundView(referenceId) && !previous && (!label?.trim() || !kind)) throw new Error('New supplemental references require label and kind')
    if (fromAppearance && !resolveCharacterDraftLayers(character).length) throw new Error('Create Appearance before capturing front')
    const blob = fromAppearance ? await exportCharacterPng(character) : providedBlob ?? (hasPayload ? (await pngFromPayload(input)).blob : undefined)
    const filename = fromAppearance ? 'front-appearance.png' : input.filename
    if (blob && (!filename?.trim() || filename.length > 200)) throw new Error('A valid filename is required')
    if (sourceSha256 && !Object.values(references).some(({ asset }) => asset.inspection.sha256 === sourceSha256) &&
      !character.variants.some(({ layers }) => Object.values(layers).some((asset) => asset?.inspection.sha256 === sourceSha256)) &&
      (await inspectCharacterImage(await exportCharacterPng(character))).sha256 !== sourceSha256) throw new Error('Source image changed; inspect source images again')
    const asset = blob ? await editor.stageAsset(blob, filename!, source, undefined, 'reference') : undefined
    await editor.dispatch((current) => {
      if (current.id !== character.id) throw new Error('Active Character changed; inspect it again')
      let sheet = characterModelSheet(current)
      const reference = referenceId ? modelSheetReferences(sheet)[referenceId] : undefined
      if (referenceId && !asset && !reference) throw new Error('Add reference art before editing or removing it')
      if (referenceId) sheet = setModelSheetReference(sheet, referenceId, remove ? undefined : {
        ...reference, ...(asset ? { asset, guides: undefined, sourceSha256: undefined, fromAppearance: fromAppearance || undefined, needsReview: undefined } : {}),
        ...(needsReview !== undefined ? { needsReview } : {}),
        ...(label !== undefined ? { label } : {}), ...(kind !== undefined ? { kind } : {}),
        ...(viewpoint !== undefined ? { viewpoint } : {}), ...(pose !== undefined ? { pose } : {}),
        ...(sourceSha256 || fromAppearance ? { sourceSha256: fromAppearance ? asset!.inspection.sha256 : sourceSha256 } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.guides !== undefined ? { guides: input.guides ?? undefined } : {}),
      } as CharacterReference)
      return updateCharacterModelSheet(current, sheet)
    }, expectedRevision)
    const saved = activeCharacter().character
    const path = modelSheetPath(saved.id, remove ? undefined : referenceId)
    return { status: 'ok', data: { accepted: true, characterId: saved.id, revision: settledRevision('Model sheet'), modelSheet: describeModelSheet(saved), visualReview: { ...MODEL_SHEET_REVIEW, path } },
      nextActions: [{ tool: 'inspect_workspace', required: true, reason: 'View the actual submitted reference and follow visualReview before continuing.', input: { includeSnapshot: true } }],
      effects: { navigation: { path, mode: 'push', reason: 'Review the exact Character reference.' } } }
  }

  const replaceCharacterAssetTool = (rawInput: unknown) => mutateCharacterAsset('replace', rawInput as CharacterAssetMutationInput)
  const repairCharacterAssetTool = (rawInput: unknown) => mutateCharacterAsset('repair', rawInput as CharacterAssetMutationInput)

  async function mutateCharacterAsset(
    mode: 'replace' | 'repair',
    input: CharacterAssetMutationInput,
    providedBlob?: Blob,
    source: 'user' | 'agent' = 'agent',
    dryRun = false,
  ) {
      const requested = input.normalization ?? NO_CHARACTER_NORMALIZATION
      const target: CharacterAssetTarget = {
        group: input.group,
        variantId: input.variantId,
        label: input.label,
        layer: input.layer,
      }
      const group = CHARACTER_CREATION_GROUPS.find(({ group }) => group === target.group)
      if (!group || !group.layers.includes(target.layer) || (target.group === 'body' && target.variantId !== 'base')) throw new Error('Unknown character asset target')
      if (input.rebaseDerivedAssets !== undefined && target.group !== 'body') throw new Error('rebaseDerivedAssets is only valid for body/base/body')
      // Mutations target the active editing session; preflight only reads persisted state.
      if (!dryRun) await editor.open(input.characterId)
      const viewed = dryRun ? await editor.view(input.characterId) : null
      const { character: current, revision } = viewed ? { character: viewed.character, revision: viewed.version } : activeCharacter()
      if (revision !== input.expectedRevision) throw new Error(`Character changed; expected revision ${input.expectedRevision}, current ${revision}`)
      const sources = resolveCharacterAssetSources(current, target)
      const assetSha256 = sources.asset?.inspection.sha256 ?? null
      if (assetSha256 !== input.expectedAssetSha256) throw new Error('Character asset changed; inspect the target again')
      if (mode === 'repair' && (target.group !== 'expression' || target.layer !== 'head' || !sources.current || !sources.editSource)) {
        throw new Error('Repair requires a current expression head; use replace_character_asset for outfits and other replacement-only target layers')
      }
      const metadataStatus = characterMetadataStatus(current, target.group, target.variantId)
      const targetVariant = current.variants.find(({ group, id }) => group === target.group && id === target.variantId)
      const outfitSlot = targetVariant?.metadata?.outfit?.slot
      if (source === 'agent' && !metadataStatus.complete) throw new Error(`Complete variant metadata before submitting pixels: ${metadataStatus.missing.join(', ')}. Use update_character_variant_metadata, then inspect_character_contract for a fresh revision.`)
      if (!(target.group === 'body' && target.variantId === 'base' && target.layer === 'body') && !sources.canonical) throw new Error('Submit body/base/body before derived character assets')
      const { filename } = input
      const payload = providedBlob ? undefined : await pngFromPayload(input)
      const submitted = providedBlob ?? payload!.blob
      let submittedInspection: CharacterAssetInspection
      try { submittedInspection = await inspectCharacterImage(submitted) }
      catch { throw new Error(`${providedBlob ? 'Submitted image' : 'Submitted PNG'} (${submitted.size} bytes${payload ? `, sha256 ${payload.receivedSha256}` : ''}) could not be decoded as PNG. Do not retry through model text; re-inspect the contract and use its browser-file-chooser fallback.`) }
      const registrationFrame = characterRegistrationFrame(current)
      const editableRegion = mode === 'repair' ? registrationFrame.editableRegions.expression : undefined
      const referenceBounds = characterReferenceBounds(registrationFrame, target.group)
      const contract = characterNormalizationContract(Boolean(referenceBounds))
      const alignmentMode = target.group === 'expression' ? 'whole-head-bounds'
        : target.group === 'outfit' ? 'pose-frame'
          : target.group === 'prop' ? 'composite-review' : 'establish-frame'

      let resizeScale: number | null = null
      let resizedBounds: CharacterBounds | undefined
      let alignTransform: CharacterVariantTransform | null = null
      let alignedBounds: CharacterBounds | null = null
      let afterResize: CharacterAlignmentMeasurement | null = null
      let afterAlignment: CharacterAlignmentMeasurement | null = null
      let finalSize: { width: number; height: number } | null = null
      let protectedRegionDelta: ReturnType<typeof measureProtectedRegionDelta> = null
      let ownership: ReturnType<typeof inspectCharacterAssetOwnership> = { status: 'valid' }
      let pointFit: ReturnType<typeof measureCharacterPointAlignment> | null = null
      const requiresPointFit = source === 'agent' && mode === 'replace' && ['outfit', 'hair', 'headwear'].includes(target.group)
      // No normalization happens silently: accepted and rejected submissions both report this.
      const report = () => {
        const bounds = alignedBounds ?? resizedBounds
        return {
          requested,
          applied: {
            resize: resizeScale === null ? 'none' as const : 'exact-aspect-downscale' as const,
            align: alignTransform ? 'reference-visible-bounds' as const : 'none' as const,
          },
          input: { width: submittedInspection.width, height: submittedInspection.height },
          final: finalSize,
          scale: resizeScale,
          transform: alignTransform,
          referenceVisibleBounds: referenceBounds ?? null,
          candidateVisibleBounds: { afterResize: resizedBounds ?? null, afterAlignment: alignedBounds },
          overflow: bounds ? {
            left: Math.max(0, -bounds.x),
            top: Math.max(0, -bounds.y),
            right: Math.max(0, bounds.x + bounds.width - CHARACTER_RIG.canvas.width),
            bottom: Math.max(0, bounds.y + bounds.height - CHARACTER_RIG.canvas.height),
          } : null,
          metrics: { afterResize, afterAlignment },
          protectedRegionDelta,
        }
      }
      const rejected = (reason: string, rejection?: { code: string; message: string }, preflightStatus = 'rejected') => ({
        status: 'ok',
        data: {
          ...(dryRun ? { preflight: true, persisted: false, canSubmit: false, status: preflightStatus } : { accepted: false }),
          target,
          filename,
          ...(rejection ? { rejection } : {}),
          inspection: {
            width: submittedInspection.width,
            height: submittedInspection.height,
            genuineRgba: submittedInspection.genuineRgba,
            hasTransparentPixels: submittedInspection.hasTransparentPixels,
            visibleBounds: submittedInspection.visibleBounds,
            visiblePixelCount: submittedInspection.visiblePixelCount,
          },
          normalization: report(),
          alignment: { mode: alignmentMode, measurement: afterAlignment ?? afterResize, pointFit },
          ownership,
        },
        nextActions: dryRun ? [] : [{
          tool: mode === 'replace' ? 'replace_character_asset' : 'repair_character_asset',
          required: true,
          reason,
          input: {
            characterId: current.id,
            group: target.group,
            variantId: target.variantId,
            label: target.label,
            layer: target.layer,
            expectedRevision: revision,
            expectedAssetSha256: assetSha256,
            normalization: contract.recommended,
          },
        }],
      })

      // 1. Deterministic downscale first, so strict inspection and stitching only ever see the exact rig canvas.
      const resize = planCharacterResize(requested.resize, submittedInspection)
      if (!resize.ok) return rejected(resize.message, { code: resize.code, message: resize.message })
      resizeScale = resize.scale
      const resized = resize.scale === null ? submitted : await renderCharacterCanvasDownscale(submitted)
      const inspection = resize.scale === null ? submittedInspection : await inspectCharacterImage(resized)
      resizedBounds = inspection.visibleBounds
      finalSize = { width: inspection.width, height: inspection.height }
      const invalidAsset = characterAssetInspectionRejection(inspection)
      if (invalidAsset) return rejected(invalidAsset.message, invalidAsset)

      // 2. One uniform scale plus translation onto the reference bounds this contract published.
      const referenceMask = sources.alignmentReference ? await readCharacterAlphaMask(sources.alignmentReference.blob) : null
      const candidateMask = await readCharacterAlphaMask(resized)
      ownership = inspectCharacterAssetOwnership(target.group, candidateMask, {
        headBounds: registrationFrame.headEnvelope?.bounds,
        bodyMask: ['outfit', 'hair', 'headwear'].includes(target.group) ? referenceMask ?? undefined : undefined,
        outfitSlot,
      })
      if (ownership.status === 'invalid') return rejected(ownership.message, { code: ownership.code, message: ownership.message })
      afterResize = measureCharacterMaskAlignment(target.group, referenceMask, candidateMask, undefined, sources.referenceTransform)
      const align = planCharacterAlignment(requested.align, target.group, inspection.visibleBounds, referenceBounds)
      if (!align.ok) return rejected(align.message, { code: align.code, message: align.message })
      if (align.transform) {
        alignTransform = align.transform
        alignedBounds = align.bounds ?? null
        afterAlignment = measureCharacterMaskAlignment(target.group, referenceMask, candidateMask, align.transform, sources.referenceTransform)
      }

      // 3. The existing safety diagnostics decide, on the normalized pixels.
      const alignment = afterAlignment ?? afterResize
      if (alignment.status === 'invalid') {
        const diagnostic = alignment.diagnostics[0]
        return rejected(diagnostic?.message ?? 'Regenerate the rejected character asset.', diagnostic && { code: diagnostic.code, message: diagnostic.message })
      }

      pointFit = input.preflightPoints ? (() => {
        if (!sources.alignmentReference || sources.alignmentReference.inspection.sha256 !== input.preflightPoints!.referenceSha256) throw new Error('Alignment reference changed; inspect the exact target again')
        return measureCharacterPointAlignment(input.preflightPoints!.points)
      })() : null
      if (requiresPointFit && !pointFit) {
        const message = 'Registered outfit, hair, and headwear submissions require 3–12 observed alignment points from the inspected candidate and alignment reference.'
        if (!dryRun) throw new Error(message)
        return rejected(message, { code: 'ALIGNMENT_POINTS_REQUIRED', message }, 'needs-alignment-points')
      }
      if (requiresPointFit && pointFit?.status === 'needs-artwork-correction') {
        const message = 'Observed attachment points cannot share one scale and translation. Correct the artwork before replacing the asset.'
        if (!dryRun) throw new Error(message)
        return rejected(message, { code: 'ALIGNMENT_POINTS_CONFLICT', message }, 'needs-artwork-correction')
      }
      // Agent-observed correspondences replace the old whole-body bounds fit for partial overlays.
      const pointTransform = requiresPointFit
        ? pointFit?.suggestedTransform ?? { x: 0, y: 0, scale: 1 }
        : null
      const autoFit = alignTransform ?? pointTransform ?? highConfidenceCharacterAutoFit(alignment)
      ownership = inspectCharacterAssetOwnership(target.group, candidateMask, {
        headBounds: registrationFrame.headEnvelope?.bounds,
        bodyMask: ['outfit', 'hair', 'headwear'].includes(target.group) ? referenceMask ?? undefined : undefined,
        transform: autoFit ?? undefined,
        outfitSlot,
      })
      if (ownership.status === 'invalid') return rejected(ownership.message, { code: ownership.code, message: ownership.message })
      const dependentAssetCount = current.variants.reduce((count, variant) => count + (variant.group === 'body' ? 0 : Object.values(variant.layers).filter(Boolean).length), 0)
      const needsRebaseDecision = target.group === 'body' && dependentAssetCount > 0 && inspection.sha256 !== assetSha256 && input.rebaseDerivedAssets !== true
      if (dryRun) {
        const canSubmit = !needsRebaseDecision && pointFit?.status !== 'needs-artwork-correction'
        return {
          status: 'ok',
          data: {
            preflight: true,
            persisted: false,
            canSubmit,
            status: needsRebaseDecision ? 'needs-rebase-decision' : pointFit ? pointFit.status : 'needs-visual-review',
            target,
            filename,
            inspection: {
              width: inspection.width,
              height: inspection.height,
              genuineRgba: inspection.genuineRgba,
              hasTransparentPixels: inspection.hasTransparentPixels,
              visibleBounds: inspection.visibleBounds,
              visiblePixelCount: inspection.visiblePixelCount,
              sha256: inspection.sha256,
            },
            previewDataUrl: await readDataUrl(resized),
            normalization: report(),
            alignment: { mode: alignmentMode, measurement: alignment, pointFit },
            ownership,
            autoFit: autoFit ? { suggested: true, transform: autoFit } : { suggested: false },
          },
          nextActions: canSubmit ? [{
            tool: 'replace_character_asset',
            required: false,
            reason: pointFit ? 'Candidate pixels and supplied correspondences passed preflight. Visually review previewDataUrl before storing, then submit the same preflightPoints.' : 'Candidate pixels passed technical preflight. Visually review previewDataUrl before storing.',
            input: { characterId: current.id, ...target, expectedRevision: revision, expectedAssetSha256: assetSha256, filename, normalization: requested,
              ...(input.preflightPoints ? { preflightPoints: input.preflightPoints } : {}) },
          }] : [],
        }
      }
      const stitchedBlob = mode === 'repair' && sources.editSource && editableRegion
        ? await renderStitchedCharacterEditBlob(
            sources.editSource.blob,
            resized,
            editableRegion,
            sources.editSourceTransform,
            autoFit ?? undefined,
          )
        : null
      const savedBlob = stitchedBlob ?? resized
      const savedInspection = stitchedBlob ? await inspectCharacterImage(stitchedBlob) : inspection
      if (target.group === 'body' && dependentAssetCount && savedInspection.sha256 !== assetSha256 && input.rebaseDerivedAssets !== true) {
        throw new Error(`Replacing this body affects ${dependentAssetCount} registered layers. For a compatible small correction set rebaseDerivedAssets:true to preserve existing layers. For changed pose, proportions, identity or registration, create a new Character instead; do not invalidate this one.`)
      }
      // Blob first; then one command (asset swap plus optional auto-fit) creates exactly one history frame.
      const asset = await editor.stageAsset(savedBlob, filename, source, savedInspection)
      await editor.dispatch((character) => {
        let placed = saveCharacterDraftAsset(character, target, asset, input.rebaseDerivedAssets === true)
        if (!stitchedBlob && autoFit && target.group !== 'body') placed = setCharacterVariantTransform(placed, target.group, target.variantId, autoFit)
        return activateCharacterVariant(placed, { group: target.group, id: target.variantId })
      }, input.expectedRevision)
      const draft = activeCharacter().character
      const savedRevision = settledRevision('Character asset')
      const savedVariant = draft.variants.find(({ group, id }) => group === target.group && id === target.variantId)!
      const specification = source === 'user' ? null : await characterTarget(draft, savedRevision, target)
      protectedRegionDelta = stitchedBlob && sources.editSource && editableRegion
        ? measureProtectedRegionDelta(
            await readCharacterPixels(sources.editSource.blob, sources.editSourceTransform),
            await readCharacterPixels(stitchedBlob),
            editableRegion,
          ) : null
      const path = characterPath(draft.id, target.group, target.variantId)
      return {
        status: 'ok',
        data: {
          accepted: true,
          target: { ...target, label: savedVariant.label },
          filename,
          byteLength: savedBlob.size,
          inspection: {
            width: savedInspection.width,
            height: savedInspection.height,
            genuineRgba: savedInspection.genuineRgba,
            hasTransparentPixels: savedInspection.hasTransparentPixels,
            visibleBounds: savedInspection.visibleBounds,
            visiblePixelCount: savedInspection.visiblePixelCount,
          },
          normalization: report(),
          alignment: specification?.alignment,
          workflow: specification ? { ...specification.workflow, nextStep: 'align-and-review' } : undefined,
          operation: mode,
          rebasedDerivedAssets: input.rebaseDerivedAssets === true ? current.variants.reduce((count, variant) => count + (variant.group === 'body' ? 0 : Object.values(variant.layers).filter((layer) => layer?.canonicalSha256 === assetSha256).length), 0) : 0,
          ownership,
          compositor: stitchedBlob ? { applied: true, protectedRegionDelta } : { applied: false },
          autoFit: autoFit ? { applied: true, transform: autoFit, bakedIntoAsset: Boolean(stitchedBlob) } : { applied: false },
          revision: savedRevision,
        },
        nextActions: specification?.nextActions ?? characterNextActions(draft),
        effects: { navigation: { path, mode: 'push', reason: 'Open the accepted Character asset for visual review.' } },
      }
  }

  async function setCharacterTransform(rawInput: unknown) {
      const input = rawInput as {
        characterId: string
        group: CharacterVariantGroup
        variantId: string
        expectedRevision: number
        x: number
        y: number
        scale: number
      }
      await editor.open(input.characterId)
      const { character: current } = activeCharacter()
      const measuredLayer = CHARACTER_CREATION_GROUPS.find(({ group }) => group === input.group)?.layers.find((layer) => current.variants.find((v) => v.group === input.group && v.id === input.variantId)?.layers[layer])
      const beforeMeasurement = measuredLayer ? (await measureCharacterFit(current, { ...input, layer: measuredLayer })).measurement : null
      const before = current.variants.find(({ group, id }) => group === input.group && id === input.variantId)?.transform ?? { x: 0, y: 0, scale: 1 }
      const calibratesHead = input.group === 'expression' && current.headRegistration?.variantId === input.variantId
      await editor.dispatch((character) => setCharacterVariantTransform(character, input.group, input.variantId, {
        x: input.x,
        y: input.y,
        scale: input.scale,
      }), input.expectedRevision)
      const draft = activeCharacter().character
      const revision = settledRevision('Character transform')
      const variant = draft.variants.find(({ group, id }) => group === input.group && id === input.variantId)!
      const firstLayer = CHARACTER_CREATION_GROUPS.find(({ group }) => group === input.group)!.layers.find((layer) => variant.layers[layer])!
      const specification = await characterTarget(draft, revision, { group: input.group, variantId: input.variantId, layer: firstLayer })
      const path = characterPath(draft.id, input.group, input.variantId)
      return {
        status: 'ok',
        data: {
          target: { group: input.group, variantId: input.variantId },
          before,
          after: variant.transform,
          comparison: { before: beforeMeasurement, after: specification?.alignment.measurement, interpretation: 'Descriptive overlap only for partial overlays; use corresponding attachment points and visual review to judge fit.' },
          rebasedVariantIds: calibratesHead ? draft.variants.filter((candidate) =>
            candidate.group === 'expression' && candidate.id !== input.variantId && isCharacterDraftAssetCurrent(draft, candidate, 'head')
          ).map(({ id }) => id) : [],
          revision,
          alignment: specification?.alignment,
          workflow: specification ? { ...specification.workflow, nextStep: 'align-and-review' } : undefined,
        },
        nextActions: specification?.nextActions ?? characterNextActions(draft),
        effects: { navigation: { path, mode: 'push', reason: 'Open the adjusted Character variant for visual review.' } },
      }
  }

  return { updateModelSheet, replaceCharacterAssetTool, repairCharacterAssetTool, mutateCharacterAsset, setCharacterTransform }
}
