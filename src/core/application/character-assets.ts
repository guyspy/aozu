import type { CharacterAppearance, CharacterAssetContent, CharacterModelSheet } from '../domain/character.ts'
import { modelSheetReferences } from './character-model-sheet.ts'

/** Shared by persistence and both ZIP formats so reference art follows the same asset lifecycle. */
export function characterAssets<A>(content: CharacterAssetContent<A>): A[] {
  return [
    ...content.variants.flatMap(({ layers }) => Object.values(layers) as A[]),
    ...[content.modelSheet, ...content.appearances?.map(({ modelSheet }) => modelSheet) ?? []]
      .flatMap((sheet) => Object.values(modelSheetReferences(sheet)).map(({ asset }) => asset)),
  ].filter((asset) => asset !== undefined)
}

export async function mapCharacterAssets<A, B>(content: CharacterAssetContent<A>, map: (asset: A, key: string) => B | Promise<B>): Promise<CharacterAssetContent<B> & { modelSheet: CharacterModelSheet<B> | undefined; appearances: CharacterAppearance<B>[] | undefined }> {
  const mapSheet = async (sheet: CharacterModelSheet<A>, prefix: string): Promise<CharacterModelSheet<B>> => {
    const entries = async (references: Record<string, { asset: A }>) => Object.fromEntries(await Promise.all(Object.entries(references).map(async ([id, reference]) =>
      [id, { ...reference, asset: await map(reference.asset, `${prefix}${id}`) }])))
    return { ...sheet, views: await entries(sheet.views), ...(sheet.references ? { references: await entries(sheet.references) } : {}) }
  }
  return {
    variants: await Promise.all(content.variants.map(async ({ layers, ...variant }) => ({
      ...variant,
      layers: Object.fromEntries(await Promise.all(Object.entries(layers).map(async ([layer, asset]) =>
        [layer, asset === undefined ? undefined : await map(asset as A, `${variant.group}-${variant.id}-${layer}`)]))),
    }))),
    modelSheet: content.modelSheet ? await mapSheet(content.modelSheet, 'reference-') : undefined,
    appearances: content.appearances ? await Promise.all(content.appearances.map(async ({ modelSheet, ...appearance }) => ({
      ...appearance, ...(modelSheet ? { modelSheet: await mapSheet(modelSheet, `appearance/${appearance.id}/reference-`) } : {}),
    }))) : undefined,
  }
}
