import { characterAssetTransfer, readDataUrl } from '../../adapters/webmcp/png-transfer.ts'
import { CHARACTER_AUTHORING_GUIDE, CHARACTER_BACKGROUND_GUIDANCE, CHARACTER_COMPONENT_RULES, CHARACTER_LAYER_GUIDANCE, CHARACTER_A_POSE_GUIDANCE, CHARACTER_VISUAL_REVIEW, MODEL_SHEET_REVIEW, characterMetadataStatus, modelSheetGenerationGuidance } from './character-agent-guidance.ts'
import { CHARACTER_ASSET_LANES, CHARACTER_ASSET_POLICY, CHARACTER_CREATION_GROUPS, characterNormalizationContract } from './character-asset-policy.ts'
import { characterCoverageContract, measureCharacterMaskAlignment, measureCharacterPointAlignment, measureProtectedRegionDelta, suggestCharacterFit, suggestCharacterVisualRegistration, type CharacterAlignmentPoint } from './character-alignment.ts'
import { REQUIRED_CHARACTER_TARGETS, characterAssetPlacement, characterRegistrationFrame, isCharacterDraftAssetCurrent, resolveCharacterAssetSources, resolveCharacterDraftLayers, resolveCharacterDraftReferenceLayers, transformCharacterBounds } from './character-creation.ts'
import { characterModelSheet, isTurnaroundView, modelSheetReferences, validateReferenceId } from './character-model-sheet.ts'
import { inspectCharacterImage, readCharacterAlphaMask, readCharacterPixels, readCharacterVisualSample, renderCharacterCompositeDataUrl, renderCharacterEditMaskDataUrl } from '../../adapters/browser/character-image.ts'
import { CHARACTER_RIG, type CharacterAssetInspection, type CharacterAssetTarget, type CharacterDraft, type CharacterReferenceMetadata, type CharacterVariantGroup, type CharacterVariantLayer } from '../domain/character.ts'
import { describeAppearances, describeModelSheet, describeReference, MODEL_SHEET_POLICY, modelSheetPath, type CharacterAssetMutationInput, type CharacterWebMcpDependencies } from './character-webmcp-shared.ts'

type CharacterBounds = NonNullable<CharacterAssetInspection['visibleBounds']>
const characterReferenceBounds = (frame: ReturnType<typeof characterRegistrationFrame>, group: CharacterVariantGroup): CharacterBounds | undefined =>
  group === 'expression' ? frame.headEnvelope?.bounds : undefined

type PreflightAsset = (
  mode: 'replace' | 'repair',
  input: CharacterAssetMutationInput,
  providedBlob?: Blob,
  source?: 'user' | 'agent',
  dryRun?: boolean,
) => Promise<{ data: Record<string, unknown>; nextActions?: unknown[] }>

export function createCharacterContractHandlers(dependencies: CharacterWebMcpDependencies, preflightAsset: PreflightAsset) {
  const { editor, activeCharacter, characterNextActions, characterPath, collectionFor, exportCharacterPng } = dependencies
  const measureCharacterFit = async (draft: CharacterDraft, target: Pick<CharacterAssetTarget, 'group' | 'variantId' | 'layer'>) => {
    const { asset, canonical, headRegistration, transform, alignmentReference, referenceTransform } = resolveCharacterAssetSources(draft, target)
    const measurement = asset ? measureCharacterMaskAlignment(
      target.group,
      alignmentReference ? await readCharacterAlphaMask(alignmentReference.blob) : null,
      await readCharacterAlphaMask(asset.blob),
      transform,
      referenceTransform,
    ) : null
    const visualFit = asset && canonical && target.group === 'expression' && headRegistration?.variant.id === target.variantId
      ? suggestCharacterVisualRegistration(await readCharacterVisualSample(canonical.blob), await readCharacterVisualSample(asset.blob), transform)
      : null
    const fit = suggestCharacterFit({
      measurement,
      visualFit,
      headAnchor: target.group === 'expression' && headRegistration?.variant.id === target.variantId,
    })
    return { measurement, visualFit, fit }
  }

  const characterFit = async (group: CharacterVariantGroup, variantId: string) => {
    const { character, revision } = activeCharacter()
    const variant = character.variants.find((candidate) => candidate.group === group && candidate.id === variantId)
    const layer = variant && CHARACTER_CREATION_GROUPS.find((candidate) => candidate.group === group)?.layers.find((candidate) => variant.layers[candidate])
    if (!variant || !layer) throw new Error('Character variant is empty or missing')
    const { fit } = await measureCharacterFit(character, { group, variantId, layer })
    return { revision, fit }
  }

  const characterTarget = async (draft: CharacterDraft, revision: number, rawInput: unknown) => {
    const input = rawInput as Partial<{ group: CharacterVariantGroup; variantId: string; layer: CharacterVariantLayer; alignmentPoints: { expectedRevision: number; assetSha256: string; referenceSha256: string; points: CharacterAlignmentPoint[] } }>
    if (!input.group && !input.variantId && !input.layer && !input.alignmentPoints) return null
    if (!input.group || !input.variantId || !input.layer) throw new Error('Character target requires group, variantId, and layer')
    const group = CHARACTER_CREATION_GROUPS.find(({ group }) => group === input.group)
    if (!group || !group.layers.includes(input.layer) || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(input.variantId)) throw new Error('Unknown character asset target')
    if (input.group === 'body' && input.variantId !== 'base') throw new Error('The body group only supports body/base/body')
    const { asset, headRegistration, current, transform, alignmentReference, referenceTransform, editSource, editSourceTransform } = resolveCharacterAssetSources(draft, input as CharacterAssetTarget)
    const variant = draft.variants.find(({ group, id }) => group === input.group && id === input.variantId)
    const coverageContract = characterCoverageContract(input.group, variant?.metadata?.outfit?.slot)
    const label = variant?.label ?? input.variantId
    const registrationFrame = characterRegistrationFrame(draft)
    const allowedOperations = [
      'replace' as const,
      ...(current && input.group === 'expression' ? ['repair' as const] : []),
      ...(current && input.group !== 'body' ? ['transform' as const] : []),
    ]
    const { measurement, visualFit, fit } = await measureCharacterFit(draft, input as CharacterAssetTarget)
    if (input.alignmentPoints && (input.alignmentPoints.expectedRevision !== revision || !asset || !current || !alignmentReference || input.group === 'body' || input.alignmentPoints.assetSha256 !== asset.inspection.sha256 || input.alignmentPoints.referenceSha256 !== alignmentReference.inspection.sha256)) throw new Error('Alignment point sources changed or are unavailable; inspect and view the exact current target and reference again')
    const pointFit = input.alignmentPoints ? measureCharacterPointAlignment(input.alignmentPoints.points, transform) : null
    const currentBounds = asset?.inspection.visibleBounds ? transformCharacterBounds(asset.inspection.visibleBounds, transform) : undefined
    const overflow = currentBounds ? {
      left: Math.max(0, -currentBounds.x),
      top: Math.max(0, -currentBounds.y),
      right: Math.max(0, currentBounds.x + currentBounds.width - CHARACTER_RIG.canvas.width),
      bottom: Math.max(0, currentBounds.y + currentBounds.height - CHARACTER_RIG.canvas.height),
    } : undefined
    const placementLayers = resolveCharacterDraftReferenceLayers(draft, { group: input.group, id: input.variantId })
    const placement = characterAssetPlacement(input.group, input.layer)
    const lineage = input.group === 'body' ? 'establish-canonical'
      : input.group === 'expression' ? headRegistration ? 'derive-from-head-registration' : 'establish-head-registration'
        : ['outfit', 'hair', 'headwear'].includes(input.group) ? 'derive-registered-overlay-from-canonical'
          : 'place-against-current-composite'
    const editableRegion = current && input.group === 'expression' ? registrationFrame.editableRegions.expression : undefined
    const referenceBounds = characterReferenceBounds(registrationFrame, input.group)
    const normalization = {
      ...characterNormalizationContract(Boolean(referenceBounds)),
      referenceVisibleBounds: referenceBounds ?? null,
    }
    const protectedRegionDelta = asset && editSource && editableRegion
      ? measureProtectedRegionDelta(
          await readCharacterPixels(editSource.blob, editSourceTransform),
          await readCharacterPixels(asset.blob, transform),
          editableRegion,
        )
      : null
    const reviewPath = characterPath(draft.id, input.group, input.variantId)
    const visualReview = input.group !== 'body' ? {
      ...CHARACTER_VISUAL_REVIEW,
      requiredAfterMutation: true,
      path: reviewPath,
      correctionTool: 'set_character_variant_transform',
      correctionScope: 'translation-and-uniform-scale-only',
      current: transform,
      axes: { x: 'right-positive', y: 'down-positive' },
      regenerateWhen: ['local deformation', 'wrong pose', 'identity drift', 'bad transparency'],
    } : { requiredAfterMutation: true, path: reviewPath, instruction: CHARACTER_A_POSE_GUIDANCE, checks: ['View the actual PNG: A-pose, complete silhouette, neutral face, identity and proportions.', 'Check real alpha and edges on light and dark backgrounds.'] }
    const replacementAction = {
      tool: 'replace_character_asset',
      required: !current,
      reason: current ? 'Replace this asset only when the user has a final target-owned layer and the client can serialize its bytes directly.' : 'Install the final exact-canvas RGBA target layer only with direct client byte serialization; otherwise ask the user to use the visible file control.',
      input: {
        characterId: draft.id,
        group: input.group,
        variantId: input.variantId,
        label,
        layer: input.layer,
        expectedRevision: revision,
        expectedAssetSha256: asset?.inspection.sha256 ?? null,
        normalization: normalization.recommended,
      },
    }
    const metadataStatus = characterMetadataStatus(draft, input.group, input.variantId)
    const metadataAction = !metadataStatus.complete ? {
      tool: 'update_character_variant_metadata',
      required: true,
      reason: `Complete ${metadataStatus.missing.join(', ')} for this asset, then re-inspect this exact target. Choose real descriptions, tags and category values from the artwork; do not copy placeholders.`,
      input: { characterId: draft.id, expectedRevision: revision, group: input.group, variantId: input.variantId, label },
    } : null
    const repairAction = current && input.group === 'expression' ? {
      tool: 'repair_character_asset',
      required: false,
      reason: 'Repair only the editable region of this existing asset; protected pixels remain byte-identical.',
      input: {
        characterId: draft.id,
        group: input.group,
        variantId: input.variantId,
        label,
        layer: input.layer,
        expectedRevision: revision,
        expectedAssetSha256: asset!.inspection.sha256,
        normalization: normalization.recommended,
      },
    } : null
    const maskFit = fit.status === 'suggested' && fit.source === 'mask-alignment'
    const fitActions = fit.status !== 'suggested' ? [] : [{
      tool: 'set_character_variant_transform',
      required: maskFit,
      reason: maskFit
        ? 'Apply the suggested absolute transform, then inspect the alpha-mask alignment again.'
        : 'Try the experimental native pixel-and-edge correlation fit, then visually review the head alignment view.',
      input: { characterId: draft.id, group: input.group, variantId: input.variantId, expectedRevision: revision, ...fit.transform },
    }]
    const reviewAction = {
      tool: 'inspect_workspace', required: true,
      reason: input.group === 'body'
        ? 'Inspect the canonical base and the current composite. Verify preserved assets still align after a compatible replacement.'
        : 'Open alignment.visualReview.path if needed, then observe this exact target in Composite, Overlay, Difference and Align. Resolve visible defects before the next asset; visiting modes is not a pass.',
      input: { intent: 'character', includeSnapshot: true },
    }
    const pointActions = pointFit?.suggestedTransform ? [{
      tool: 'set_character_variant_transform', required: false,
      reason: 'Check the observed correspondences, then apply this absolute fit and re-measure the same points. It does not prove visual correctness.',
      input: { characterId: draft.id, group: input.group, variantId: input.variantId, expectedRevision: revision, ...pointFit.suggestedTransform },
    }] : []
    const nextActions = metadataAction ? [metadataAction] : !current ? [replacementAction]
      : [reviewAction, ...pointActions, ...fitActions,
        ...(pointFit?.status === 'needs-artwork-correction' ? [{ ...replacementAction, reason: 'Observed attachment points cannot share one scale and translation. Correct the artwork; do not force a whole-body fit.' }] : []),
        ...(repairAction ? [repairAction] : [])]
    const dependentAssetCount = input.group === 'body' && asset ? draft.variants.reduce((count, candidate) => count + (candidate.group === 'body' ? 0 : Object.values(candidate.layers).filter(Boolean).length), 0) : 0
    return {
      input: { group: input.group, variantId: input.variantId, layer: input.layer },
      allowedOperations,
      metadataStatus,
      componentRules: CHARACTER_COMPONENT_RULES,
      workflow: {
        nextStep: !metadataStatus.complete ? 'complete-metadata' : current ? 'review-or-replace' : 'prepare-and-submit',
        steps: ['agree-components', 'inspect-source', 'prepare-background-removal', 'prepare-target-pixels', 'complete-metadata', 'submit', 'align-and-review'],
        instruction: CHARACTER_LAYER_GUIDANCE[input.group],
        visualReview: 'Required after every accepted change; current:true means registered, not visually reviewed or user-approved.',
      },
      expectedRevision: revision,
      current: asset ? {
        filled: true,
        current,
        dataUrl: await readDataUrl(asset.blob),
        filename: asset.filename,
        sha256: asset.inspection.sha256,
        transform,
      } : { filled: false, current: false, transform },
      required: REQUIRED_CHARACTER_TARGETS.some((target) => target.group === input.group && target.variantId === input.variantId && target.layer === input.layer),
      acceptance: CHARACTER_ASSET_LANES[input.group],
      coverageContract,
      placement: { slot: placement.slot, slotOrder: CHARACTER_RIG.slots.find(({ id }) => id === placement.slot)!.order, layerOrder: placement.order },
      alignmentReference: alignmentReference ? {
        filename: alignmentReference.filename,
        sha256: alignmentReference.inspection.sha256,
        transform: referenceTransform ?? { x: 0, y: 0, scale: 1 },
        dataUrl: await readDataUrl(alignmentReference.blob),
      } : null,
      editSource: editSource ? {
        filename: editSource.filename,
        sha256: editSource.inspection.sha256,
        transform: editSourceTransform ?? { x: 0, y: 0, scale: 1 },
        coordinates: 'final-canvas',
        visibleBounds: editSource.inspection.visibleBounds && editSourceTransform
          ? transformCharacterBounds(editSource.inspection.visibleBounds, editSourceTransform)
          : editSource.inspection.visibleBounds,
        dataUrl: editSourceTransform ? await renderCharacterCompositeDataUrl([{
          id: 'edit-source', blobId: 'edit-source', slot: 'expression-head',
          slotOrder: 35, layerOrder: 0, transform: editSourceTransform, blob: editSource.blob,
        }]) : await readDataUrl(editSource.blob),
      } : null,
      editableRegion: editableRegion ? {
        ...editableRegion,
        mask: {
          filename: `${input.group}-${input.variantId}-${input.layer}-edit-mask.png`,
          mediaType: 'image/png',
          semantics: 'transparent-editable-opaque-protected',
          dataUrl: renderCharacterEditMaskDataUrl(editableRegion),
        },
      } : null,
      ownership: input.group === 'expression' ? {
        assetRole: 'whole-head',
        outside: 'transparent',
        bounds: registrationFrame.headEnvelope?.bounds ?? null,
      } : ['outfit', 'hair', 'headwear'].includes(input.group) ? {
        assetRole: `${input.group}-only-overlay`,
        characterPixels: 'forbidden',
        layerSemantics: input.layer === 'back' ? 'only pixels genuinely behind the canonical body/head' : 'visible overlay pixels',
      } : {
        assetRole: input.group === 'body' ? 'canonical-body' : 'object-with-optional-gripping-hand-patch',
      },
      ...(input.group === 'body' ? { replacementImpact: {
        dependentAssetCount,
        requiresExplicitRebaseChoice: dependentAssetCount > 0,
        rebaseMeaning: 'For a compatible small correction, explicitly set rebaseDerivedAssets:true after comparing pose, silhouette and registration. This preserves pixels, transforms and selections, but is not a geometric proof. Major changes must use a new Character; false is rejected when dependent artwork exists.',
      } } : {}),
      generationRecipe: {
        lineage,
        ...(input.group === 'body' ? { pose: 'a-pose', instruction: CHARACTER_A_POSE_GUIDANCE } : {}),
        method: CHARACTER_LAYER_GUIDANCE[input.group],
        placementReference: placementLayers.length ? {
          layerCount: placementLayers.length,
          dataUrl: await renderCharacterCompositeDataUrl(placementLayers),
        } : null,
        preserveCanvasCoordinates: true,
        backgroundPreparation: CHARACTER_BACKGROUND_GUIDANCE,
        output: {
          generateAt: normalization.generateAt,
          finalizeAt: { ...CHARACTER_RIG.canvas },
          rgba: true,
          realAlpha: true,
          content: input.group === 'body' ? 'canonical-body'
            : input.group === 'expression' ? 'complete-whole-head'
              : ['outfit', 'hair', 'headwear'].includes(input.group) ? `${input.group}-only-overlay` : 'object-with-optional-gripping-hand-patch',
        },
      },
      alignment: {
        mode: input.group === 'expression' ? 'whole-head-bounds'
          : ['outfit', 'hair', 'headwear'].includes(input.group) ? 'pose-frame'
            : input.group === 'prop' ? 'composite-review'
              : 'establish-frame',
        transform,
        referenceBounds: measurement && 'metrics' in measurement && measurement.metrics && 'referenceBounds' in measurement.metrics
          ? measurement.metrics.referenceBounds : undefined,
        candidateBounds: currentBounds,
        overflow,
        measurement,
        protectedRegionDelta,
        autoFit: fit,
        visualFit,
        pointFit,
        pointComparison: {
          tool: 'inspect_character_contract', inputField: 'alignmentPoints',
          available: Boolean(asset && current && alignmentReference && input.group !== 'body'),
          expectedRevision: revision,
          assetSha256: asset?.inspection.sha256 ?? null, referenceSha256: alignmentReference?.inspection.sha256 ?? null,
          coordinates: 'reference points on the rendered alignmentReference at 512×768; candidate points on the raw target image downscaled to 512×768, before its transform',
          instruction: 'View both images. Supply 3–12 labelled matching attachment points spread across the item. Use actual corresponding contacts, not whole-body bounds. Read before/after residuals; never invent points to obtain a fit.',
        },
        normalization,
        visualReview,
        registration: input.group === 'expression' ? {
          role: headRegistration?.variant.id === input.variantId ? 'head-anchor' : 'follower',
          anchorVariantId: headRegistration?.variant.id ?? null,
          calibration: headRegistration?.variant.id === input.variantId ? {
            status: 'visual-required',
            compareAgainst: 'canonical-body-default-head',
            tool: 'set_character_variant_transform',
            rebasesCurrentExpressions: true,
          } : null,
        } : null,
        reviewPath,
      },
      nextActions,
    }
  }

  async function inspectCharacterContract(rawInput: unknown) {
      const { characterId, scope = 'appearance', candidate, ...targetInput } = rawInput as { characterId: string; scope?: 'appearance' | 'model-sheet'; candidate?: Pick<CharacterAssetMutationInput, 'filename' | 'dataUrl' | 'dataSha256' | 'normalization' | 'rebaseDerivedAssets' | 'preflightPoints'> }
      if (scope === 'model-sheet') {
        if ('alignmentPoints' in targetInput || candidate) throw new Error('Candidate images and alignment points require scope:appearance and an exact target')
        return inspectModelSheetContract(rawInput)
      }
      if (['referenceId', 'images', 'label', 'kind', 'viewpoint', 'pose', 'sourceSha256'].some((key) => key in targetInput)) throw new Error('Reference inputs require scope:model-sheet')
      const { character: draft, version } = await editor.view(characterId)
      const canonical = draft.variants.find(({ group, id }) => group === 'body' && id === 'base')?.layers.body
      const target = await characterTarget(draft, version, targetInput)
      if (candidate && !target) throw new Error('Candidate preflight requires group, variantId, and layer')
      const candidatePreflight = candidate && target ? await preflightAsset('replace', {
        ...candidate,
        characterId: draft.id,
        ...target.input,
        label: draft.variants.find(({ group, id }) => group === target.input.group && id === target.input.variantId)?.label ?? target.input.variantId,
        expectedRevision: version,
        expectedAssetSha256: target.current?.sha256 ?? null,
      }, undefined, 'agent', true) : null
      return {
        status: 'ok',
        data: {
          collection: await collectionFor(draft.id),
          rig: CHARACTER_RIG,
          creationGroups: CHARACTER_CREATION_GROUPS,
          variants: draft.variants.map((variant) => ({
            group: variant.group,
            id: variant.id,
            label: variant.label,
            metadata: variant.metadata ?? null,
            layers: CHARACTER_CREATION_GROUPS.find(({ group }) => group === variant.group)!.layers.map((layer) => ({
              layer,
              filled: Boolean(variant.layers[layer]),
              current: isCharacterDraftAssetCurrent(draft, variant, layer),
            })),
          })),
          character: {
            id: draft.id,
            name: draft.name,
            description: draft.description ?? '',
            backstory: draft.backstory ?? '',
            attributes: draft.attributes ?? {},
            heightCm: draft.modelSheet?.heightCm ?? null,
            selected: draft.selected,
            faceStyles: draft.faceStyles,
            ...describeAppearances(draft),
            revision: version,
          },
          modelSheet: describeModelSheet(draft),
          modelSheetPolicy: MODEL_SHEET_POLICY,
          registrationFrame: characterRegistrationFrame(draft),
          canonicalReference: canonical ? {
            filename: canonical.filename,
            sha256: canonical.inspection.sha256,
            ...(target ? {} : { dataUrl: await readDataUrl(canonical.blob) }),
          } : null,
          assetTransfer: characterAssetTransfer(target ? {
            path: target.alignment.reviewPath,
            selector: `input[data-webmcp-upload="character-asset"][data-group="${target.input.group}"][data-variant-id="${target.input.variantId}"][data-layer="${target.input.layer}"]`,
            triggerSelector: `[data-webmcp-upload-trigger="character-asset"][data-group="${target.input.group}"][data-variant-id="${target.input.variantId}"][data-layer="${target.input.layer}"]`,
            label: target.input.group === 'body' ? 'Replace canonical body PNG' : target.input.layer === 'back' ? 'Behind character · Optional' : target.input.group === 'expression' ? 'Head' : 'Primary sprite',
          } : undefined),
          authoringGuide: CHARACTER_AUTHORING_GUIDE,
          productionBrief: [
            'Use the Collection context and Character profile; the user-approved artwork is the source of truth.',
            CHARACTER_A_POSE_GUIDANCE,
            target ? CHARACTER_LAYER_GUIDANCE[target.input.group] : 'Choose one target and re-inspect before generating. Follow the guide for garment, hairstyle, prop and Facial Variant workflows.',
            'Complete target.metadataStatus through update_character_variant_metadata before submission. Record provenance only from known source hashes.',
            'Keep image bytes in host memory using assetTransfer.toolkit. Review each accepted image before the next asset; metadata and technical acceptance do not establish user approval.',
          ],
          assetPolicy: CHARACTER_ASSET_POLICY,
          target,
          candidatePreflight: candidatePreflight?.data ?? null,
        },
        nextActions: candidatePreflight?.nextActions ?? target?.nextActions ?? characterNextActions(draft),
      }
  }

  async function inspectModelSheetContract(rawInput: unknown) {
    const { characterId, referenceId, images = [], scope: _scope, ...metadata } = rawInput as CharacterReferenceMetadata & { characterId: string; referenceId?: string; images?: string[]; scope: string }
    if (['group', 'variantId', 'layer'].some((key) => key in metadata)) throw new Error('Model-sheet references do not use Appearance group/variant/layer targets')
    if (referenceId) validateReferenceId(referenceId)
    const { character: draft, version } = await editor.view(characterId)
    const references = modelSheetReferences(characterModelSheet(draft))
    const current = referenceId ? references[referenceId] : undefined
    const sourceImages = await Promise.all(images.map(async (id) => {
      const asset = id === 'canonical' ? draft.variants.find(({ group, id }) => group === 'body' && id === 'base')?.layers.body : references[id]?.asset
      const blob = id === 'appearance' ? await exportCharacterPng(draft) : asset?.blob
      if (!blob || (id === 'appearance' && !resolveCharacterDraftLayers(draft).length)) throw new Error(`Source image ${id} is missing; inspect the model sheet or create Appearance first`)
      const inspection = asset?.inspection ?? await inspectCharacterImage(blob)
      return { id, filename: asset?.filename ?? 'appearance.png', sha256: inspection.sha256, width: inspection.width, height: inspection.height,
        ...(id === 'appearance' ? { selected: draft.selected } : {}), dataUrl: await readDataUrl(blob) }
    }))
    const submission = referenceId ? { characterId: draft.id, expectedRevision: version, referenceId, ...metadata,
      expectedAssetSha256: current?.asset.inspection.sha256 ?? null } : undefined
    const nextActions = submission ? [{ tool: 'update_character_model_sheet', required: false,
      reason: 'After generating and visually checking art, submit image bytes only when the client can serialize them directly; otherwise ask the user to use the visible file control. For metadata-only edits, add notes or guides.', input: submission },
      ...(referenceId === 'front' ? [{ tool: 'update_character_model_sheet', required: false, reason: 'Capture the actual current Appearance into front without regenerating it; then visually review its pose.', input: { ...submission, fromAppearance: true } }] : [])] : []
    return { status: 'ok', data: {
      character: { id: draft.id, name: draft.name, description: draft.description ?? '', backstory: draft.backstory ?? '', attributes: draft.attributes ?? {}, heightCm: draft.modelSheet?.heightCm ?? null, revision: version, selected: draft.selected, ...describeAppearances(draft) },
      collection: await collectionFor(draft.id), modelSheet: describeModelSheet(draft), assetPolicy: MODEL_SHEET_POLICY,
      assetTransfer: characterAssetTransfer(referenceId ? current || isTurnaroundView(referenceId) ? {
        path: modelSheetPath(draft.id, referenceId),
        selector: `input[data-webmcp-upload="model-sheet-reference"][data-reference-id="${referenceId}"]`,
      } : {
        path: modelSheetPath(draft.id, 'new'),
        selector: 'input[data-webmcp-upload="model-sheet-new-reference"]',
      } : undefined),
      authoringGuide: CHARACTER_AUTHORING_GUIDE,
      generationGuidance: modelSheetGenerationGuidance(metadata.kind ?? current?.kind ?? (referenceId && isTurnaroundView(referenceId) ? 'full-body' : undefined)),
      sourceImages, target: referenceId ? { referenceId, current: current ? describeReference(current) : null, ...metadata } : null,
      productionBrief: [
        'References belong to modelSheet.appearanceId. Edits automatically save into the current Appearance, including its expression/outfit/ordered props. Use set_character_variant_selection with appearance:{action:"save-as",id,label} BEFORE editing to keep the original look, appearance:{action:"create",id,label} for a new look with no selected variants or references, appearance:{action:"select",id} to switch, or appearance:{action:"delete",id} to remove a look and its references (keep at least one). Shared assets are retained. Switching waits for saving and starts a new Appearance undo session. Shared variant art affects all looks that use it. Captured fronts follow composition edits; existing other views are retained with needsReview:true after the composition changes. Inspect and visually compare them before replacing art or clearing needsReview. Default adopts legacy working art in memory; reads do not save. Save-as keeps the combination with a front and empty other views; create keeps the shared body/assets with no selected variants and an empty sheet.',
        'Use images:["appearance"] for the current composed outfit/expression/props; canonical is only the base body. Use stored reference IDs (for example front) for an established sheet baseline. Open/decode and actually view each source PNG before generating.',
        'Keep one consistent outfit and identity across the four turnaround views. Save as captures the new look’s front; use fromAppearance to explicitly fill or replace one. Add new leaves references empty until you add them or edit the composition. Do not create a second mandatory A-pose. T-pose and raised-arm images use separate supplemental IDs with kind:structure.',
        'Create only the reference requested: a complete full-body view, head angle sheet, expression sheet, pose, detail or palette sheet. Use label, kind, viewpoint and pose to identify it. New supplemental references require label and kind.',
        'Generate PNG with a neutral background that does not interfere with silhouette or color judgment, or a transparent background; choose according to the reference purpose. Use an appropriate original canvas, at most 4096 × 4096 and 5 MiB. No background removal or 512 × 768 normalization is needed for references. Do not fit a wide T-pose to the Appearance silhouette.',
        'Supply sourceSha256 from the image used as the primary source. Set optional heightCm through update_character_profile (null clears it); never put it in custom attributes. Height is a character property; image guides are y fractions from the top. Do not infer centimeters from pixels or calibrate a head/detail collage as full-body height.',
        'Landmark editing, automatic lineup and approval workflow are planned, not available tools. Do not add skeleton data or claim user approval in metadata.',
      ], visualReview: { ...MODEL_SHEET_REVIEW, path: modelSheetPath(draft.id, current ? referenceId : undefined) },
    }, nextActions }
  }

  return { measureCharacterFit, characterFit, characterTarget, inspectCharacterContract }
}
