import type { LevelData } from '../shared/types';
import type { LevelStore } from '../levels/store';
import { countBones, countDogs, parseLevel } from '../game/level';

export interface MenuOptions {
  store: LevelStore;
  onPlay: (level: LevelData) => void;
  onEdit: (level?: LevelData) => void;
}

export class MainMenu {
  private root: HTMLDivElement;

  constructor(private parent: HTMLElement, private opts: MenuOptions) {
    this.root = document.createElement('div');
    this.root.className = 'menu overlay';
    this.root.innerHTML = `
      <h1>Dog Chase Bones</h1>
      <p class="menu-sub">Slide the blocks. Open a path. Feed every dog.</p>
      <div class="menu-list">Loading…</div>
      <button class="btn" data-act="new">+ Create New Level</button>`;
    this.root.querySelector('[data-act="new"]')!.addEventListener('click', () => this.opts.onEdit());
    this.parent.appendChild(this.root);
    void this.load();
  }

  private async load() {
    const levels = await this.opts.store.list();
    if (!this.root.isConnected) return;

    const list = this.root.querySelector('.menu-list')!;
    list.innerHTML = '';
    if (!levels.length) { list.textContent = 'No levels yet.'; return; }

    for (const lv of levels) {
      const { spec } = parseLevel(lv);
      const draft = Boolean((lv.meta as Record<string, unknown> | undefined)?.draft);

      const row = document.createElement('div');
      row.className = 'level-row';

      const card = document.createElement('button');
      card.className = 'level-card';
      card.innerHTML = `<span class="level-name"></span>
        <span class="level-meta">${spec.cols}x${spec.rows} · ${countDogs(spec)} dogs · ${countBones(spec)} bones · ${spec.timeLimit}s</span>`;
      card.querySelector('.level-name')!.textContent = lv.name;
      if (draft) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'draft';
        card.querySelector('.level-name')!.appendChild(tag);
      }
      card.onclick = () => this.opts.onPlay(lv);

      const edit = document.createElement('button');
      edit.className = 'btn ghost small level-edit';
      edit.textContent = 'Edit';
      edit.onclick = () => this.opts.onEdit(lv);

      row.append(card, edit);
      list.appendChild(row);
    }
  }

  dispose() { this.root.remove(); }
}
