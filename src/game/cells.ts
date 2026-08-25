// Cell index helpers. A cell is addressed by (c, r) and stored as a flat
// index r * cols + c so board state can live in plain arrays and Sets.

export type Dir = 'up' | 'right' | 'down' | 'left';

export const DIRS: readonly Dir[] = ['up', 'right', 'down', 'left'];

export const DIR_VEC: Record<Dir, { dc: number; dr: number }> = {
  up: { dc: 0, dr: -1 },
  right: { dc: 1, dr: 0 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
};

export function idx(cols: number, c: number, r: number): number {
  return r * cols + c;
}

export function colOf(cols: number, i: number): number {
  return i % cols;
}

export function rowOf(cols: number, i: number): number {
  return Math.floor(i / cols);
}

export function inBounds(cols: number, rows: number, c: number, r: number): boolean {
  return c >= 0 && c < cols && r >= 0 && r < rows;
}

// Orthogonal neighbours of `i`, in DIRS order, clipped to the grid.
export function neighbours(cols: number, rows: number, i: number): number[] {
  const c = colOf(cols, i);
  const r = rowOf(cols, i);
  const out: number[] = [];
  for (const d of DIRS) {
    const { dc, dr } = DIR_VEC[d];
    const nc = c + dc;
    const nr = r + dr;
    if (inBounds(cols, rows, nc, nr)) out.push(idx(cols, nc, nr));
  }
  return out;
}

export function isDir(v: unknown): v is Dir {
  return v === 'up' || v === 'right' || v === 'down' || v === 'left';
}
