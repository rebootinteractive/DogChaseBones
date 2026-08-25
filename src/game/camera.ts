import { colOf, idx, rowOf } from './cells';
import { SETTINGS } from './settings';
import { STAGE_H, STAGE_W } from '../shared/stage';

/**
 * The camera fits the whole grid inside the rect left over after the four
 * margins in gameSettings.json, using square cells. Dog queues render in those
 * margins and are allowed to run off-screen.
 */
export interface Camera {
  cols: number;
  rows: number;
  cell: number;
  originX: number;
  originY: number;
}

export function computeCamera(cols: number, rows: number, s = SETTINGS): Camera {
  const m = s.camera.margin;
  const fitW = Math.max(1, STAGE_W - m.left - m.right);
  const fitH = Math.max(1, STAGE_H - m.top - m.bottom);
  const raw = Math.min(fitW / cols, fitH / rows);
  const cell = Math.max(s.camera.minCellSize, Math.min(s.camera.maxCellSize, raw));
  return {
    cols,
    rows,
    cell,
    originX: m.left + (fitW - cols * cell) / 2,
    originY: m.top + (fitH - rows * cell) / 2,
  };
}

export function cellX(cam: Camera, cell: number): number {
  return cam.originX + colOf(cam.cols, cell) * cam.cell;
}

export function cellY(cam: Camera, cell: number): number {
  return cam.originY + rowOf(cam.cols, cell) * cam.cell;
}

export function cellCenter(cam: Camera, cell: number): { x: number; y: number } {
  return { x: cellX(cam, cell) + cam.cell / 2, y: cellY(cam, cell) + cam.cell / 2 };
}

export function colRowCenter(cam: Camera, c: number, r: number): { x: number; y: number } {
  return { x: cam.originX + (c + 0.5) * cam.cell, y: cam.originY + (r + 0.5) * cam.cell };
}

/** Stage point -> cell, or null when the point is outside the grid. */
export function cellAt(cam: Camera, x: number, y: number): number | null {
  const c = Math.floor((x - cam.originX) / cam.cell);
  const r = Math.floor((y - cam.originY) / cam.cell);
  if (c < 0 || c >= cam.cols || r < 0 || r >= cam.rows) return null;
  return idx(cam.cols, c, r);
}

/** Stage delta -> whole-cell delta, for translating a drag into slide steps. */
export function toCellDelta(cam: Camera, dx: number, dy: number): { dc: number; dr: number } {
  return { dc: Math.round(dx / cam.cell), dr: Math.round(dy / cam.cell) };
}

export interface ViewSize { width: number; height: number }

/**
 * The editor is not the phone frame. It fits the grid to whatever room the
 * scene panel has, keeping `padCells` of margin on every side so the dog queues
 * -- which sit one cell outside the grid -- stay on screen. Cells are allowed to
 * get small: a designer on a monitor can still read a 14x14 board.
 */
export function computeEditorCamera(cols: number, rows: number, view: ViewSize, s = SETTINGS): Camera {
  const pad = s.editor.padCells * 2;
  const w = Math.max(1, view.width);
  const h = Math.max(1, view.height);
  const raw = Math.min(w / (cols + pad), h / (rows + pad));
  const cell = Math.max(s.editor.minCellSize, Math.min(s.editor.maxCellSize, raw));
  return {
    cols,
    rows,
    cell,
    originX: (w - cols * cell) / 2,
    originY: (h - rows * cell) / 2,
  };
}
