export type PngPayload = { dataUrl?: string; dataSha256?: string }

export const readDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read asset'))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

const pngFromDataUrl = (dataUrl: string) => {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match || dataUrl.length > 7_100_000) throw new Error('Expected a PNG data URL under 5 MiB')
  const bytes = Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0))
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) throw new Error('Submitted dataUrl is not PNG bytes; provide the complete original PNG base64 payload')
  return new Blob([bytes], { type: 'image/png' })
}

const sha256Blob = async (blob: Blob) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
  (byte) => byte.toString(16).padStart(2, '0'),
).join('')

export const pngFromPayload = async ({ dataUrl, dataSha256 }: PngPayload) => {
  if (!dataUrl) throw new Error('Provide one complete PNG dataUrl built directly from local file bytes in the ChatGPT Browser Use host runtime')
  const blob = pngFromDataUrl(dataUrl)
  const receivedSha256 = await sha256Blob(blob)
  if (dataSha256 && receivedSha256 !== dataSha256) throw new Error(`PNG payload changed in transit; expected sha256 ${dataSha256}, received ${receivedSha256}. Re-read the local PNG and rebuild dataUrl in the same Browser Use host-runtime call.`)
  return { blob, receivedSha256 }
}

export const blobFromDataUrl = (dataUrl: string) => {
  const match = /^data:(application\/zip|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match || dataUrl.length > 28_000_000) throw new Error('Expected a supported base64 data URL under 20 MiB')
  return new Blob([Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0))], { type: match[1] })
}

export const characterAssetTransfer = (fallback?: { path: string; selector: string; triggerSelector?: string; label?: string }) => ({
  protocol: 'chatgpt-host-data-url-v1',
  toolkit: {
    runtime: 'ChatGPT Browser Use host JavaScript',
    read: "const { readFile } = await import('node:fs/promises'); const bytes = await readFile(trustedLocalPngPath)",
    hash: "const { createHash } = await import('node:crypto'); const dataSha256 = createHash('sha256').update(bytes).digest('hex')",
    encode: "const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`",
    call: 'const webmcp = await aozuTab.capabilities.get("webmcp"); const tools = await webmcp.fetchTools(); await tools.call(toolName, { ...requiredInput, filename, dataUrl, dataSha256 })',
    rule: 'Read, encode, and call WebMCP in the same host-runtime execution. Keep bytes in memory; never print or route base64 through model text, terminal output, or the clipboard.',
  },
  input: { dataUrl: 'one complete data:image/png;base64 string', dataSha256: 'lowercase hex SHA-256 of original PNG bytes' },
  ...(fallback ? { fallback: {
    kind: 'browser-file-chooser', accept: 'image/png', ...fallback,
    instruction: fallback.triggerSelector
      ? 'Navigate to path, start Browser Use waitForEvent("filechooser"), click triggerSelector, and set the trusted local PNG path. selector identifies the exact input only; do not click a different visible uploader.'
      : 'Navigate to path, start Browser Use waitForEvent("filechooser"), click selector, and set the trusted local PNG path.',
  } } : {}),
})
