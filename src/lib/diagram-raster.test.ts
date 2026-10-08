import { describe, expect, it } from 'vitest'
import { MAX_DIAGRAM_WIDTH, rasterSize, svgNaturalSize } from './diagram-raster'

// mermaid.render() and canvas only exist in a browser, so renderDiagramPng itself
// is covered by scripts/cdp-verify-diagram-raster.mjs. What is testable here are
// the two sizing rules everything else depends on.

describe('svgNaturalSize', () => {
  it('reads the viewBox mermaid always sets, ignoring the responsive width', () => {
    // This is the real shape of mermaid's output under useMaxWidth: the width
    // attribute is a percentage and carries no information.
    expect(
      svgNaturalSize({ viewBox: '0 0 310.5 674', width: '100%', height: null }),
    ).toEqual({ width: 310.5, height: 674 })
  })

  it('takes the size from the viewBox, not its origin', () => {
    expect(svgNaturalSize({ viewBox: '-8 -8 476.07 389', width: null, height: null })).toEqual({
      width: 476.07,
      height: 389,
    })
  })

  it('accepts comma separated viewBox numbers', () => {
    expect(svgNaturalSize({ viewBox: '0,0,665.25,450', width: null, height: null })).toEqual({
      width: 665.25,
      height: 450,
    })
  })

  it('falls back to explicit pixel attributes when there is no usable viewBox', () => {
    expect(svgNaturalSize({ viewBox: null, width: '476.07px', height: '389px' })).toEqual({
      width: 476.07,
      height: 389,
    })
  })

  it('falls through a malformed viewBox to the attributes', () => {
    expect(svgNaturalSize({ viewBox: '0 0 310', width: '310px', height: '674px' })).toEqual({
      width: 310,
      height: 674,
    })
  })

  it('refuses a percentage width as a fallback: it is not a size', () => {
    expect(svgNaturalSize({ viewBox: null, width: '100%', height: null })).toBeNull()
  })

  it('refuses a zero sized viewBox', () => {
    expect(svgNaturalSize({ viewBox: '0 0 0 0', width: null, height: null })).toBeNull()
  })

  it('refuses markup carrying no size at all', () => {
    expect(svgNaturalSize({ viewBox: null, width: null, height: null })).toBeNull()
  })
})

describe('rasterSize', () => {
  it('draws a narrow diagram at the displayed width, not at its own', () => {
    // 310x674 is what the probe measures for the flowchart. The article shows it
    // at the column width anyway (every theme's imageBlock sets width:100%), so
    // rasterising at 620px would hand the browser a bitmap to upscale.
    expect(rasterSize(310, 674)).toEqual({
      width: 677,
      height: 1472,
      pixelWidth: 1354,
      pixelHeight: 2944,
    })
  })

  it('shrinks a wider diagram onto the column and scales the height with it', () => {
    // 688x490 is what the probe measures for the sequence diagram.
    expect(rasterSize(688, 490)).toEqual({
      width: MAX_DIAGRAM_WIDTH,
      height: 482,
      pixelWidth: 1354,
      pixelHeight: 964,
    })
  })

  it('leaves a diagram sitting exactly on the column width alone', () => {
    expect(rasterSize(MAX_DIAGRAM_WIDTH, 400)).toEqual({
      width: 677,
      height: 400,
      pixelWidth: 1354,
      pixelHeight: 800,
    })
  })

  it('rounds a fractional intrinsic size rather than carrying it into the canvas', () => {
    expect(rasterSize(476.07373046875, 389)).toEqual({
      width: 677,
      height: 553,
      pixelWidth: 1354,
      pixelHeight: 1106,
    })
  })

  it('never rasterises wider than twice the column', () => {
    const { pixelWidth } = rasterSize(20000, 100)
    expect(pixelWidth).toBe(MAX_DIAGRAM_WIDTH * 2)
  })

  it('derives the pixel size from the logical size, so no second rounding creeps in', () => {
    for (const [w, h] of [
      [310, 674],
      [688, 490],
      [476.07, 389],
      [120, 90],
      [5000, 250],
    ]) {
      const r = rasterSize(w, h)
      expect(r.pixelWidth).toBe(r.width * 2)
      expect(r.pixelHeight).toBe(r.height * 2)
    }
  })

  it('holds the source aspect ratio to within the integer rounding', () => {
    for (const [w, h] of [
      [310, 674],
      [688, 490],
      [476.07, 389],
      [120, 90],
    ]) {
      const r = rasterSize(w, h)
      expect(Math.abs(r.width / r.height - w / h)).toBeLessThan(0.02)
    }
  })

  it('never rounds a very thin diagram down to a zero pixel edge', () => {
    const r = rasterSize(4000, 1)
    expect(r.height).toBeGreaterThanOrEqual(1)
    expect(r.pixelHeight).toBeGreaterThanOrEqual(1)
  })

  it('scales a diagram tall enough to threaten the canvas limit down instead', () => {
    const r = rasterSize(300, 10000)
    expect(r.pixelHeight).toBeLessThanOrEqual(12000)
    expect(r.pixelWidth).toBeLessThan(MAX_DIAGRAM_WIDTH * 2)
    // The logical size shrinks with it, so the article never lays out a size the
    // raster cannot back.
    expect(r.width).toBe(180)
    expect(r.height).toBe(6000)
  })
})

describe('the module itself', () => {
  it('imports under Node without touching a DOM', async () => {
    // The dynamic import of mermaid lives inside renderDiagramPng, so loading the
    // module must not need a browser. This is what keeps mermaid's megabytes out
    // of the first-load bundle.
    expect(typeof document).toBe('undefined')
    const mod = await import('./diagram-raster')
    expect(typeof mod.renderDiagramPng).toBe('function')
    expect(mod.MAX_DIAGRAM_WIDTH).toBe(677)
  })
})
