import type { LevelData } from '../../src/shared/types';
import { parseLevel } from '../../src/game/level';
import { createBoard } from '../../src/game/board';
import type { BoardState } from '../../src/game/board';
import { finishWalker, isWon, resolveMoves } from '../../src/game/resolve';
import { stepGroup } from '../../src/game/slide';
import { DIRS, DIR_VEC, colOf, rowOf } from '../../src/game/cells';
import type { Dir } from '../../src/game/cells';

/**
 * Exhaustive soft-lock analysis.
 *
 * A soft lock is not "a level that is hard". It is a *reachable* board state
 * from which winning has become impossible, in a level that was winnable to
 * begin with -- and which the game never tells the player about, because the
 * only loss condition is the clock.
 *
 * This walks the whole reachable state graph -- every group, every direction,
 * every distance a finger could stop at, with the dogs resolving after each
 * release exactly as `GameApp` does -- and marks a state solvable when some
 * path from it reaches a win. Everything else is a grave.
 */

export interface Move { group: string; dir: Dir; cells: number }

export function cloneState(s: BoardState): BoardState {
  return {
    cols: s.cols,
    rows: s.rows,
    dead: new Set(s.dead),
    walls: new Set(s.walls),
    bees: new Set(s.bees),
    units: new Map([...s.units].map(([c, u]) => [c, { ...u }])),
    bones: new Map([...s.bones].map(([c, b]) => [c, { ...b }])),
    groups: new Map([...s.groups].map(([g, cells]) => [g, new Set(cells)])),
    queues: s.queues.map((q) => ({ ...q })),
    walkers: s.walkers.map((w) => ({ ...w, path: [...w.path] })),
    reserved: new Set(s.reserved),
  };
}

/** Drag released: send every dog that can go, land them, repeat until settled. */
export function playOut(state: BoardState): number {
  let eaten = 0;
  for (let guard = 0; guard < 500; guard++) {
    resolveMoves(state);
    if (state.walkers.length === 0) return eaten;
    for (const w of [...state.walkers]) { finishWalker(state, w); eaten++; }
  }
  throw new Error('playOut never settled');
}

/** Physical configuration, independent of group id naming. */
export function key(s: BoardState): string {
  const groups = [...s.groups.values()]
    .map((cells) => [...cells].sort((a, b) => a - b).join('.'))
    .sort()
    .join('|');
  const bones = [...s.bones]
    .map(([c, b]) => `${c}:${b.count}`)
    .sort()
    .join(',');
  return `${groups}#${bones}#${s.queues.map((q) => q.remaining).join('/')}`;
}

/** Every board a single drag-and-release could produce from here. */
export function successors(s: BoardState): Array<{ move: Move; state: BoardState }> {
  const out: Array<{ move: Move; state: BoardState }> = [];
  const reach = Math.max(s.cols, s.rows);
  for (const group of [...s.groups.keys()]) {
    for (const dir of DIRS) {
      const { dc, dr } = DIR_VEC[dir];
      const cur = cloneState(s);
      for (let cells = 1; cells <= reach; cells++) {
        if (!stepGroup(cur, group, dc, dr)) break;
        const state = cloneState(cur);
        playOut(state);
        out.push({ move: { group, dir, cells }, state });
      }
    }
  }
  return out;
}

export interface Node {
  state: BoardState;
  won: boolean;
  edges: Array<{ move: Move; to: string }>;
  from: Array<{ move: Move; from: string }>;
  depth: number;
  path: Move[];
}

export interface Analysis {
  nodes: Map<string, Node>;
  start: string;
  /** Keys of states from which no sequence of drags can ever win. */
  dead: Set<string>;
  winnable: boolean;
  /** Shortest drag sequence from the start into a dead state, if one exists. */
  fatal: { path: Move[]; move: Move; before: BoardState; after: BoardState } | null;
}

export function analyze(level: LevelData, limit = 200_000): Analysis {
  const { spec } = parseLevel(level);
  const start = createBoard(spec);
  playOut(start); // GameApp.load() sends dogs before the player touches anything

  const nodes = new Map<string, Node>();
  const startKey = key(start);
  nodes.set(startKey, { state: start, won: isWon(start), edges: [], from: [], depth: 0, path: [] });

  const frontier = [startKey];
  while (frontier.length) {
    const k = frontier.shift()!;
    const node = nodes.get(k)!;
    if (node.won) continue; // the level is over; nothing follows
    if (nodes.size > limit) throw new Error('state space too large');

    for (const { move, state } of successors(node.state)) {
      const nk = key(state);
      let next = nodes.get(nk);
      if (!next) {
        next = { state, won: isWon(state), edges: [], from: [], depth: node.depth + 1, path: [...node.path, move] };
        nodes.set(nk, next);
        frontier.push(nk);
      }
      if (nk === k) continue; // a drag that changed nothing
      node.edges.push({ move, to: nk });
      next.from.push({ move, from: k });
    }
  }

  // A state is solvable when a win is reachable from it: reverse-flood from wins.
  const solvable = new Set<string>();
  const stack: string[] = [];
  for (const [k, n] of nodes) if (n.won) { solvable.add(k); stack.push(k); }
  while (stack.length) {
    const k = stack.pop()!;
    for (const { from } of nodes.get(k)!.from) {
      if (solvable.has(from)) continue;
      solvable.add(from);
      stack.push(from);
    }
  }

  const dead = new Set([...nodes.keys()].filter((k) => !solvable.has(k)));

  // The shortest way a player can walk off the cliff: a live state with a move into a dead one.
  let fatal: Analysis['fatal'] = null;
  const live = [...nodes.entries()]
    .filter(([k]) => solvable.has(k))
    .sort((a, b) => a[1].depth - b[1].depth);
  outer: for (const [, node] of live) {
    for (const e of node.edges) {
      if (!dead.has(e.to)) continue;
      fatal = { path: node.path, move: e.move, before: node.state, after: nodes.get(e.to)!.state };
      break outer;
    }
  }

  return { nodes, start: startKey, dead, winnable: solvable.has(startKey), fatal };
}

// --------------------------------------------------------------- rendering ---

export function render(s: BoardState): string[] {
  const out: string[] = [];
  for (let r = 0; r < s.rows; r++) {
    let line = '';
    for (let c = 0; c < s.cols; c++) {
      const i = r * s.cols + c;
      const u = s.units.get(i);
      if (u) line += s.bones.has(i) ? u.group[0].toUpperCase() : u.group[0];
      else if (s.dead.has(i)) line += 'X';
      else if (s.walls.has(i)) line += '#';
      else if (s.bees.has(i)) line += '*';
      else line += '.';
    }
    out.push(line);
  }
  return out;
}

export function describe(s: BoardState, m: Move): string {
  const cells = [...(s.groups.get(m.group) ?? [])].sort((a, b) => a - b);
  const at = cells.map((c) => `(${colOf(s.cols, c)},${rowOf(s.cols, c)})`).join('');
  return `drag ${m.group} ${at} ${m.dir} ${m.cells}`;
}

/**
 * Drags-to-win for every state, by reverse BFS from the wins. Infinity means a
 * grave. The gap between a state's number and its successor's is what a wrong
 * order of play actually costs the player.
 */
export function distToWin(a: Analysis): Map<string, number> {
  const dist = new Map<string, number>();
  const q: string[] = [];
  for (const [k, n] of a.nodes) if (n.won) { dist.set(k, 0); q.push(k); }
  while (q.length) {
    const k = q.shift()!;
    const d = dist.get(k)!;
    for (const { from } of a.nodes.get(k)!.from) {
      if (dist.has(from)) continue;
      dist.set(from, d + 1);
      q.push(from);
    }
  }
  return dist;
}
