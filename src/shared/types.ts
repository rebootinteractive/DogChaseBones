// A placed element inside a level. `type` keys into the prototype's palette.
// x/y are normalized stage coordinates in [0,1] so levels are resolution-independent.
export interface GameElement {
  type: string;
  x: number;
  y: number;
  // per-mechanic extra fields (rotation, color, size...) live here
  [key: string]: unknown;
}

// One authored level: content placed within the fixed stage.
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
