import { describe, it, expect } from 'vitest';
import { cellAt, cellCenter, computeCamera, computeEditorCamera, toCellDelta } from '../src/game/camera';
import { STAGE_H, STAGE_W } from '../src/shared/stage';

const s = {
  camera: { margin: { top: 132, right: 56, bottom: 56, left: 56 }, maxCellSize: 64, minCellSize: 16 },
} as never;

describe('computeCamera', () => {
  it('fills the fit rect with square cells and centres the grid', () => {
    const cam = computeCamera(6, 10, s);
    const fitW = STAGE_W - 56 - 56;
    const fitH = STAGE_H - 132 - 56;
    expect(cam.cell).toBeCloseTo(Math.min(fitW / 6, fitH / 10));
    expect(cam.originX).toBeCloseTo(56 + (fitW - 6 * cam.cell) / 2);
    expect(cam.originY).toBeCloseTo(132 + (fitH - 10 * cam.cell) / 2);
  });

  it('keeps the same outer footprint whatever the grid size', () => {
    for (const [c, r] of [[5, 5], [6, 10], [9, 12]] as const) {
      const cam = computeCamera(c, r, s);
      expect(cam.originX + c * cam.cell).toBeLessThanOrEqual(STAGE_W - 56 + 0.001);
      expect(cam.originY + r * cam.cell).toBeLessThanOrEqual(STAGE_H - 56 + 0.001);
    }
  });

  it('caps the cell size so a tiny grid does not blow up', () => {
    expect(computeCamera(2, 2, s).cell).toBe(64);
  });
});

describe('cellAt', () => {
  it('round-trips the centre of every cell', () => {
    const cam = computeCamera(6, 10, s);
    for (let i = 0; i < 60; i++) {
      const p = cellCenter(cam, i);
      expect(cellAt(cam, p.x, p.y)).toBe(i);
    }
  });

  it('is null outside the grid', () => {
    const cam = computeCamera(6, 10, s);
    expect(cellAt(cam, 0, 0)).toBeNull();
    expect(cellAt(cam, STAGE_W, STAGE_H)).toBeNull();
  });
});

describe('toCellDelta', () => {
  it('rounds a drag in pixels to whole cells', () => {
    const cam = computeCamera(6, 10, s);
    expect(toCellDelta(cam, cam.cell * 2.4, -cam.cell * 0.9)).toEqual({ dc: 2, dr: -1 });
    expect(toCellDelta(cam, 1, 1)).toEqual({ dc: 0, dr: 0 });
  });
});

describe('computeEditorCamera', () => {
  const s = { editor: { padCells: 1.7, minCellSize: 10, maxCellSize: 84 } } as never;

  it('fits the grid plus its queue margin inside the scene pane', () => {
    const cam = computeEditorCamera(6, 10, { width: 900, height: 700 }, s);
    const pad = 1.7 * cam.cell;
    expect(cam.originX).toBeGreaterThanOrEqual(pad - 0.001);
    expect(cam.originY).toBeGreaterThanOrEqual(pad - 0.001);
    expect(cam.originX + 6 * cam.cell).toBeLessThanOrEqual(900 - pad + 0.001);
    expect(cam.originY + 10 * cam.cell).toBeLessThanOrEqual(700 - pad + 0.001);
  });

  it('centres the grid in the pane', () => {
    const cam = computeEditorCamera(7, 7, { width: 800, height: 600 }, s);
    expect(cam.originX + (7 * cam.cell) / 2).toBeCloseTo(400);
    expect(cam.originY + (7 * cam.cell) / 2).toBeCloseTo(300);
  });

  it('grows the cells on a big monitor, up to the cap', () => {
    const small = computeEditorCamera(6, 10, { width: 393, height: 620 }, s);
    const big = computeEditorCamera(6, 10, { width: 1200, height: 900 }, s);
    expect(big.cell).toBeGreaterThan(small.cell);
    expect(computeEditorCamera(2, 2, { width: 2000, height: 2000 }, s).cell).toBe(84);
  });

  it('lets cells go small rather than clipping a large board', () => {
    const cam = computeEditorCamera(14, 14, { width: 380, height: 380 }, s);
    expect(cam.cell).toBeGreaterThanOrEqual(10);
    expect(cam.cell).toBeLessThan(30);
  });

  it('survives a pane that has not been laid out yet', () => {
    const cam = computeEditorCamera(6, 10, { width: 0, height: 0 }, s);
    expect(Number.isFinite(cam.cell)).toBe(true);
    expect(cam.cell).toBe(10);
  });
});
