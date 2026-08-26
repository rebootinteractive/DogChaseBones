import type { LevelData } from '../shared/types';
import type { LevelStore } from '../levels/store';
import { countBones, countDogs, parseLevel } from '../game/level';
import { exportFileName, exportPayload } from '../levels/exportLevel';

export interface MenuOptions {
  store: LevelStore;
  onPlay: (level: LevelData) => void;
  onEdit: (level?: LevelData) => void;
}

export class MainMenu {
  private root: HTMLDivElement;
  private levels: LevelData[] = [];
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  constructor(private parent: HTMLElement, private opts: MenuOptions) {
    this.root = document.createElement('div');
    this.root.className = 'menu overlay';
    this.root.innerHTML = `
      <h1>Dog Chase Bones</h1>
      <p class="menu-sub">Slide the blocks. Open a path. Feed every dog.</p>
      <p class="menu-status"></p>
      <div class="menu-list">Loading…</div>
      <div class="menu-actions">
        <button class="btn" data-act="new">+ Create New Level</button>
        <button class="btn ghost" data-act="export" disabled>Download all levels</button>
      </div>`;
    // Say plainly whether a saved level can reach anyone else. Without this the
    // only difference between local-only and connected is invisible.
    const status = this.root.querySelector<HTMLElement>('.menu-status')!;
    status.textContent = opts.store.canPublish
      ? 'Shared levels are on — Publish sends a level to everyone.'
      : 'Local only — Save keeps a level in this browser; Publish gives you JSON to commit.';
    status.classList.toggle('live', opts.store.canPublish);

    this.root.querySelector('[data-act="new"]')!.addEventListener('click', () => this.opts.onEdit());
    this.root.querySelector('[data-act="export"]')!.addEventListener('click', (ev) =>
      this.downloadAll(ev.currentTarget as HTMLButtonElement));
    this.parent.appendChild(this.root);
    void this.load();
  }

  private async load() {
    const levels = await this.opts.store.list();
    if (!this.root.isConnected) return;
    this.levels = levels;

    const exportBtn = this.root.querySelector<HTMLButtonElement>('[data-act="export"]')!;
    exportBtn.disabled = levels.length === 0;
    exportBtn.textContent = levels.length ? `Download all levels (${levels.length})` : 'Download all levels';

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

  /**
   * One .json per level, named in menu order, ready to drop into
   * src/levels/published/ and commit. Drafts live only in this browser's
   * localStorage, so this is how they become real levels.
   *
   * Staggered: browsers quietly drop a burst of downloads fired in one tick,
   * and the first one triggers a permission prompt that must be answered.
   */
  private downloadAll(btn: HTMLButtonElement) {
    const levels = this.levels;
    if (!levels.length) return;

    btn.disabled = true;
    let done = 0;

    levels.forEach((level, i) => {
      this.timers.push(setTimeout(() => {
        if (!this.root.isConnected) return;
        const json = JSON.stringify(exportPayload(level), null, 2);
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = exportFileName(level, i);
        a.click();
        URL.revokeObjectURL(url);

        done++;
        btn.textContent = done < levels.length
          ? `Downloading ${done}/${levels.length}…`
          : `Downloaded ${levels.length} ✓`;

        if (done === levels.length) {
          this.timers.push(setTimeout(() => {
            if (!this.root.isConnected) return;
            btn.disabled = false;
            btn.textContent = `Download all levels (${levels.length})`;
          }, 2500));
        }
      }, i * 140));
    });
  }

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.root.remove();
  }
}
