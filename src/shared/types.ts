// A placed element inside a level. `type` names the kind of thing it is.
//
// x/y are integer CELL coordinates -- column and row, origin top left, y down.
// They are not pixels and not normalized: the camera fits the grid at runtime,
// so a fraction of the screen would mean nothing. src/game/level.ts owns the
// list of types and what each one's extra fields mean.
export interface GameElement {
  type: string;
  x: number;
  y: number;
  // per-element extra fields (a block's `cells`, a bone's `count`/`order`,
  // a queue's `dir`/`count`) live here
  [key: string]: unknown;
}

// One authored level. `meta` carries { schema, cols, rows, timeLimit }; read
// meta.schema before anything else, and see docs/level-data.md for why.
export interface LevelData {
  id: string;
  name: string;
  prototype: string;       // namespace; matches config.PROTOTYPE
  elements: GameElement[];
  meta?: Record<string, unknown>;
}

// The fixed stage (scene composition), locked once with Claude.
// Mirrors the committed composition.html. The editor never changes this.
export interface StageDef {
  width: number;           // logical units (e.g. 393)
  height: number;          // logical units (e.g. 852)
  zones: StageZone[];      // fixed labelled regions
}

export interface StageZone {
  id: string;
  label: string;
  x: number; y: number; w: number; h: number;  // normalized [0,1]
}

// Backend abstraction so LevelStore is testable without a network.
export interface LevelsBackend {
  fetch(prototype: string): Promise<LevelData[]>;
  insert(level: LevelData): Promise<void>;
}
