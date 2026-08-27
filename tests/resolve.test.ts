import { describe, it, expect } from 'vitest';
import { bonesRemaining } from '../src/game/board';
import { finishWalker, isWon, resolveMoves } from '../src/game/resolve';
import { canStepGroup, slideGroupBy } from '../src/game/slide';
import { boardFromAscii, toAscii } from './helpers';

describe('resolveMoves', () => {
  it('sends a leader that has a safe route and reserves the path plus its bone', () => {
    const b = boardFromAscii(['..A.', '####'], [{ c: 0, r: 0, dir: 'up', count: 2 }]);
    const out = resolveMoves(b);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ queueId: 'q0', boneCell: 2 });
    expect(b.queues[0].remaining).toBe(1);
    // route cells 0 and 1, plus cell 2 so the bone cannot be slid away
    expect([...b.reserved].sort((x, y) => x - y)).toEqual([0, 1, 2]);
  });

  it('locks the route against block slides', () => {
    const b = boardFromAscii(['...A', 'b###'], [{ c: 0, r: 0, dir: 'up', count: 1 }]);
    expect(canStepGroup(b, 'b', 0, -1)).toBe(true);
    resolveMoves(b);
    expect(canStepGroup(b, 'b', 0, -1)).toBe(false);
  });

  it('sends nothing while the bee can reach the only corridor', () => {
    const b = boardFromAscii(['..A.', '....', '.*..'], [{ c: 0, r: 0, dir: 'up', count: 1 }]);
    expect(resolveMoves(b)).toEqual([]);
    expect(b.queues[0].remaining).toBe(1);
  });

  it('runs at most one dog per queue at a time', () => {
    const b = boardFromAscii(['.AA.', '####'], [{ c: 0, r: 0, dir: 'up', count: 3 }]);
    expect(resolveMoves(b)).toHaveLength(1);
    expect(resolveMoves(b)).toHaveLength(0);
    expect(b.walkers).toHaveLength(1);
  });

  it('serves two queues at once and never gives them the same bone', () => {
    const b = boardFromAscii(
      ['A..B', '....', '####'],
      [{ c: 0, r: 1, dir: 'left', count: 1 }, { c: 3, r: 1, dir: 'right', count: 1 }],
    );
    const out = resolveMoves(b);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((c) => c.boneCell)).size).toBe(2);
  });

  it('does not send routes that would cross each other', () => {
    const b = boardFromAscii(['A.', '..', 'B.'], [{ c: 1, r: 1, dir: 'right', count: 2 }]);
    const out = resolveMoves(b);
    expect(out).toHaveLength(1);
    expect(b.reserved.size).toBe(out[0].path.length + 1);   // + the bone cell
  });
});

describe('finishWalker', () => {
  it('eats the bone, frees the route and splits the host group', () => {
    const b = boardFromAscii(['aAa.', '....', '####'], [{ c: 3, r: 0, dir: 'up', count: 1 }]);
    resolveMoves(b);
    expect(b.walkers).toHaveLength(1);

    const result = finishWalker(b, b.walkers[0]);
    expect(result.boneCell).toBe(1);
    expect(result.groups).toHaveLength(2);
    expect(b.units.has(1)).toBe(false);
    expect(b.reserved.size).toBe(0);
    expect(b.walkers).toHaveLength(0);
    expect(toAscii(b)).toEqual(['a.a.', '....', '####']);
  });

  it('lets the next dog in the queue go once the board has changed', () => {
    const b = boardFromAscii(['.AA.', '####'], [{ c: 0, r: 0, dir: 'up', count: 2 }]);
    resolveMoves(b);
    finishWalker(b, b.walkers[0]);
    expect(resolveMoves(b)).toHaveLength(1);
    expect(b.queues[0].remaining).toBe(0);
  });
});

describe('isWon', () => {
  it('is true only once every queue is empty and nobody is still walking', () => {
    const b = boardFromAscii(['A...', '....', '####'], [{ c: 0, r: 1, dir: 'left', count: 1 }]);
    expect(isWon(b)).toBe(false);
    resolveMoves(b);
    expect(isWon(b)).toBe(false);
    finishWalker(b, b.walkers[0]);
    expect(isWon(b)).toBe(true);
  });
});

describe('eating off the queue', () => {
  it('sends the leader with an empty route, holding only the bone it is eating', () => {
    const b = boardFromAscii(['A...', '....'], [{ c: 0, r: 0, dir: 'left', count: 1 }]);
    const out = resolveMoves(b);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ path: [], boneCell: 0 });
    expect([...b.reserved]).toEqual([0]);   // no route walked, but the bone is pinned
    expect(b.queues[0].remaining).toBe(0);
  });

  it('leaves other groups free to slide while it eats', () => {
    const b = boardFromAscii(['A.b.', '....'], [{ c: 0, r: 0, dir: 'left', count: 1 }]);
    resolveMoves(b);
    expect(canStepGroup(b, 'b', 1, 0)).toBe(true);
  });

  it('clears the entry cell so the next dog can walk in', () => {
    const b = boardFromAscii(['Aa.B', '....'], [{ c: 0, r: 0, dir: 'left', count: 2 }]);

    resolveMoves(b);
    finishWalker(b, b.walkers[0]);
    expect(b.units.has(0)).toBe(false);

    // Entry is open now, so the second dog walks in for the far bone.
    const second = resolveMoves(b);
    expect(second).toHaveLength(1);
    expect(second[0].boneCell).toBe(3);
    expect(second[0].path.length).toBeGreaterThan(0);
    finishWalker(b, b.walkers[0]);
    expect(isWon(b)).toBe(true);
  });

  it('splits the host group when the eaten unit was holding it together', () => {
    const b = boardFromAscii(['aAa.', '....'], [{ c: 1, r: 0, dir: 'up', count: 1 }]);
    resolveMoves(b);
    const result = finishWalker(b, b.walkers[0]);
    expect(result.groups).toHaveLength(2);
  });

  it('serves one dog per queue even when the bone is right there', () => {
    const b = boardFromAscii(['A...', '....'], [{ c: 0, r: 0, dir: 'left', count: 3 }]);
    expect(resolveMoves(b)).toHaveLength(1);
    expect(resolveMoves(b)).toHaveLength(0);
  });
});

describe('a unit carrying several bones', () => {
  const stacked = (bones: number, dogs: number) => {
    const b = boardFromAscii(['A...', '....'], [{ c: 0, r: 1, dir: 'left', count: dogs }]);
    b.bones.set(0, { count: bones, order: 1 });
    return b;
  };

  it('survives a bite while bones are left, and keeps its group', () => {
    const b = stacked(3, 3);
    resolveMoves(b);
    const first = finishWalker(b, b.walkers[0]);
    expect(first).toMatchObject({ bonesLeft: 2, destroyed: false });
    expect(b.units.has(0)).toBe(true);
    expect(b.bones.get(0)!.count).toBe(2);
  });

  it('is destroyed only when the last bone goes', () => {
    const b = stacked(2, 2);
    resolveMoves(b);
    finishWalker(b, b.walkers[0]);
    expect(b.units.has(0)).toBe(true);

    resolveMoves(b);
    const last = finishWalker(b, b.walkers[0]);
    expect(last).toMatchObject({ bonesLeft: 0, destroyed: true });
    expect(b.units.has(0)).toBe(false);
    expect(isWon(b)).toBe(true);
  });

  it('only splits its group on the last bone', () => {
    const b = boardFromAscii(['aAa.', '....', '####'], [{ c: 3, r: 0, dir: 'up', count: 2 }]);
    b.bones.set(1, { count: 2, order: 1 });

    resolveMoves(b);
    expect(finishWalker(b, b.walkers[0]).groups).toEqual(['a']);
    expect(b.groups.get('a')!.size).toBe(3);

    resolveMoves(b);
    expect(finishWalker(b, b.walkers[0]).groups).toHaveLength(2);
  });

  it('lets two queues claim two bones off the same unit at once', () => {
    const b = boardFromAscii(['.A..', '....', '####'], [
      { c: 0, r: 0, dir: 'up', count: 1 },
      { c: 3, r: 0, dir: 'up', count: 1 },
    ]);
    b.bones.set(1, { count: 2, order: 1 });
    const out = resolveMoves(b);
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.boneCell === 1)).toBe(true);
  });

  it('never sends more dogs than the stack has bones', () => {
    const b = boardFromAscii(['.A..', '....', '####'], [
      { c: 0, r: 0, dir: 'up', count: 1 },
      { c: 3, r: 0, dir: 'up', count: 1 },
    ]);
    expect(b.bones.get(1)!.count).toBe(1);
    expect(resolveMoves(b)).toHaveLength(1);
  });

  it('counts every bone in the stack as remaining', () => {
    const b = stacked(4, 1);
    expect(bonesRemaining(b)).toBe(4);
  });
});


describe('the bone a dog has committed to', () => {
  it('cannot be slid out from under it', () => {
    const b = boardFromAscii(['....A.', '......', '######'], [{ c: 0, r: 0, dir: 'up', count: 1 }]);
    resolveMoves(b);
    expect(b.walkers[0].boneCell).toBe(4);

    expect(slideGroupBy(b, 'a', 0, 1)).toEqual({ dc: 0, dr: 0 });
    expect(canStepGroup(b, 'a', 0, 1)).toBe(false);

    const result = finishWalker(b, b.walkers[0]);
    expect(result.destroyed).toBe(true);
    expect(bonesRemaining(b)).toBe(0);
    expect(isWon(b)).toBe(true);
  });

  it('is released again once the dog has eaten', () => {
    const b = boardFromAscii(['.A..b.', '......', '######'], [{ c: 0, r: 0, dir: 'up', count: 1 }]);
    resolveMoves(b);
    expect(canStepGroup(b, 'a', 0, 1)).toBe(false);
    finishWalker(b, b.walkers[0]);
    expect(b.reserved.size).toBe(0);
    expect(canStepGroup(b, 'b', 0, 1)).toBe(true);
  });

  it('leaves every other group free to move meanwhile', () => {
    const b = boardFromAscii(['.A..b.', '......', '######'], [{ c: 0, r: 0, dir: 'up', count: 1 }]);
    resolveMoves(b);
    expect(canStepGroup(b, 'b', 0, 1)).toBe(true);
  });

  it('stays pinned while a second dog is still coming for the same stack', () => {
    const b = boardFromAscii(['.A..', '....', '####'], [
      { c: 0, r: 0, dir: 'up', count: 1 },
      { c: 3, r: 0, dir: 'up', count: 1 },
    ]);
    b.bones.set(1, { count: 2, order: 1 });
    resolveMoves(b);
    expect(b.walkers).toHaveLength(2);

    finishWalker(b, b.walkers[0]);
    expect(b.reserved.has(1)).toBe(true);      // the other dog still wants it
    expect(canStepGroup(b, 'a', 0, 1)).toBe(false);

    finishWalker(b, b.walkers[0]);
    expect(b.reserved.size).toBe(0);
  });
});
