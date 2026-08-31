// The logical stage the camera fits into. Everything is authored at this width
// and fitted to the device by GameApp/EditorApp.
export const STAGE_W = 393;

/** The design height: what a 393x852 phone frame gives, and the editor default. */
export const STAGE_H = 852;

/**
 * The shortest stage we will stretch to. Below this the stage is letterboxed
 * instead, so a landscape window gets a small board rather than a squashed one.
 */
export const STAGE_MIN_H = 560;

export interface StageFit {
  /** Device pixels per stage unit. */
  scale: number;
  /** Stage height to lay the camera out in -- 852 on the design frame, less on a short viewport. */
  stageH: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Fit the stage to a view. The stage keeps its 393pt width on every device and
 * takes its height from the view, so a browser whose chrome eats 150pt of
 * height loses board height -- it does not pillarbox the whole stage and shrink
 * the side margins along with it.
 */
export function fitStage(viewW: number, viewH: number): StageFit {
  const w = Math.max(1, viewW);
  const h = Math.max(1, viewH);
  const scaleW = w / STAGE_W;
  const stageH = Math.max(STAGE_MIN_H, h / scaleW);
  const scale = Math.min(scaleW, h / stageH);
  return {
    scale,
    stageH,
    offsetX: (w - STAGE_W * scale) / 2,
    offsetY: (h - stageH * scale) / 2,
  };
}
