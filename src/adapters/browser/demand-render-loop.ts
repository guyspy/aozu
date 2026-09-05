/** One pending frame at most; render returns whether motion needs another frame. */
export function createDemandRenderLoop(render: (delta: number) => boolean) {
  let frame: number | undefined, previous: number | undefined
  let visible = true, destroyed = false
  const stop = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    previous = undefined
  }
  const invalidate = () => {
    if (!destroyed && visible && frame === undefined) frame = requestAnimationFrame(tick)
  }
  const tick = (time: number) => {
    frame = undefined
    const delta = previous === undefined ? 0 : Math.min((time - previous) / 1000, .05)
    previous = time
    if (render(delta)) invalidate()
    if (frame === undefined) previous = undefined
  }
  return {
    invalidate,
    setVisible(next: boolean) {
      visible = next
      if (visible) invalidate()
      else stop()
    },
    destroy() { destroyed = true; stop() },
  }
}
