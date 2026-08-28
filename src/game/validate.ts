import { boundaryDirs, createBoard, islands } from './board';
import { beeReach } from './pathing';
import { DIR_VEC, DIRS, colOf, idx, inBounds, rowOf } from './cells';
import { countBones, countDogs } from './level';
import type { LevelSpec } from './level';

/**
 * Structural warnings only -- the things that make a level impossible on its
 * face. Never blocking: the editor shows these and still lets you save.
 */
export function validateLevel(spec: LevelSpec): string[] {
  const out: string[] = [];
  const at = (cell: number) => `(${colOf(spec.cols, cell)}, ${rowOf(spec.cols, cell)})`;

  const dogs = countDogs(spec);
  const bones = countBones(spec);

  if (spec.queues.length === 0) out.push('No dog queues -- this level cannot be won.');
  if (bones === 0) out.push('No bones -- place a bone on a block unit.');
  if (dogs > bones) out.push(`${dogs} dogs but only ${bones} bones -- not every dog can be fed.`);

  const seenCells = new Set<number>();
  for (const q of spec.queues) {
    if (seenCells.has(q.cell)) out.push(`Two queues share the entry cell ${at(q.cell)}.`);
    seenCells.add(q.cell);

    if (spec.dead.has(q.cell)) out.push(`Queue at ${at(q.cell)}: entry cell is switched off.`);
    else if (spec.walls.has(q.cell)) out.push(`Queue at ${at(q.cell)}: entry cell is a wall, no dog can enter.`);
    else if (spec.bees.has(q.cell)) out.push(`Queue at ${at(q.cell)}: entry cell holds a bee.`);

    const dirs = boundaryDirs(spec, q.cell);
    if (!dirs.includes(q.dir)) {
      out.push(
        dirs.length
          ? `Queue at ${at(q.cell)} faces ${q.dir}, which is inside the board. Valid: ${dirs.join(', ')}.`
          : `Queue at ${at(q.cell)} is not on a boundary -- no side of it is off-grid or switched off.`,
      );
    }
  }

  // A grid dog on a queue's entry cell seals that queue in -- the third way to
  // make a mistake the entry-cell checks above already catch for walls and bees.
  const queueCells = new Set(spec.queues.map((q) => q.cell));
  for (const cell of spec.gridDogs) {
    if (queueCells.has(cell)) {
      out.push(`Dog at ${at(cell)} stands on a queue entry cell -- that queue can never enter.`);
    }
  }

  // A bee beside a grid dog poisons it where it stands, and it can never set
  // off. Bee reach never *contains* the dog's cell, because that cell is not
  // passable -- so exposure is adjacency, to a bee cell or a bee-reachable one.
  if (spec.gridDogs.length && spec.bees.size) {
    const reach = beeReach(createBoard(spec));
    for (const cell of spec.gridDogs) {
      const c = colOf(spec.cols, cell);
      const r = rowOf(spec.cols, cell);
      const exposed = DIRS.some((d) => {
        const { dc, dr } = DIR_VEC[d];
        const nc = c + dc;
        const nr = r + dr;
        if (!inBounds(spec.cols, spec.rows, nc, nr)) return false;
        const n = idx(spec.cols, nc, nr);
        return spec.bees.has(n) || reach.has(n);
      });
      if (exposed) out.push(`Dog at ${at(cell)} is exposed to a bee and can never set off.`);
    }
  }

  // Dogs and bones are trapped on their own island; check each one separately.
  // Walls and bees fence a region just as dead cells do -- none of them move.
  const parts = islands(spec);
  if (parts.length > 1) {
    parts.forEach((cells, n) => {
      const islandDogs =
        spec.queues.filter((q) => cells.has(q.cell)).reduce((a, q) => a + q.count, 0) +
        spec.gridDogs.filter((cell) => cells.has(cell)).length;
      const islandBones = [...spec.bones]
        .reduce((n, [cell, stack]) => n + (cells.has(cell) ? stack.count : 0), 0);
      if (islandDogs === 0) return;
      if (islandBones === 0) out.push(`Island ${n + 1}: ${islandDogs} dogs and no bones.`);
      else if (islandDogs > islandBones) out.push(`Island ${n + 1}: ${islandDogs} dogs but only ${islandBones} bones.`);
    });
  }

  return out;
}
