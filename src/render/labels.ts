import { Container, Text, TextStyle } from 'pixi.js';
import type { TextStyleOptions } from 'pixi.js';

/**
 * A reusable set of Text objects. Pixi Text is expensive to build and easy to
 * leak, so labels are created once and hidden when a frame does not need them
 * rather than destroyed and remade.
 *
 * Usage per frame: begin(), add(...) for each label, end().
 */
export class LabelPool {
  readonly view = new Container();
  private pool: Text[] = [];
  private used = 0;

  constructor(private style: TextStyleOptions) {}

  begin() { this.used = 0; }

  add(x: number, y: number, text: string, scale = 1) {
    let label = this.pool[this.used];
    if (!label) {
      label = new Text({ text, style: new TextStyle(this.style) });
      label.anchor.set(0.5);
      this.pool.push(label);
      this.view.addChild(label);
    }
    if (label.text !== text) label.text = text;
    label.visible = true;
    label.position.set(x, y);
    label.scale.set(scale);
    this.used++;
  }

  end() {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  destroy() {
    this.pool = [];
    if (!this.view.destroyed) this.view.destroy({ children: true });
  }
}
