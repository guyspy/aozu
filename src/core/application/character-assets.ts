import type { CharacterAssetContent, CharacterModelSheet } from '../domain/character.ts'

/** Shared by persistence and both ZIP formats so reference art follows the same asset lifecycle. */
export function characterAssets<A>(content: CharacterAssetContent<A>): A[] {
  return [
    ...content.variants.flatMap(({ layers }) => Object.values(layers) as A[]),
    ...Object.values(content.modelSheet?.views ?? {}).map(({ asset }) => asset),
  ].filter((asset) => asset !== undefined)
}

export async function mapCharacterAssets<A, B>(content: CharacterAssetContent<A>, map: (asset: A, key: string) => B | Promise<B>): Promise<CharacterAssetContent<B> & { modelSheet: CharacterModelSheet<B> | undefined }> {
  return {
    variants: await Promise.all(content.variants.map(async ({ layers, ...variant }) => ({
      ...variant,
      layers: Object.fromEntries(await Promise.all(Object.entries(layers).map(async ([layer, asset]) =>
        [layer, asset === undefined ? undefined : await map(asset as A, `${variant.group}-${variant.id}-${layer}`)]))),
    }))),
    modelSheet: content.modelSheet ? {
      ...content.modelSheet,
      views: Object.fromEntries(await Promise.all(Object.entries(content.modelSheet.views).map(async ([view, reference]) =>
        [view, { ...reference, asset: await map(reference.asset, `reference-${view}`) }]))),
    } : undefined,
  }
}
