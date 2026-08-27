import type { LevelData } from '../shared/types';
import type { LevelLibrary } from '../levels/library';
import type { SourceId } from '../levels/sources/types';
import { countBones, countDogs, parseLevel } from '../game/level';
import { exportFileName, exportPayload } from '../levels/exportLevel';

export interface MenuOptions {
  library: LevelLibrary;
  onPlay: (level: LevelData) => void;
  onEdit: (level: LevelData | undefined, source: SourceId) => void;
}

/**
 * Three tabs, one per source, never merged.
 *
 * Merging them meant a local copy silently replaced a same-id level from the
 * server, so a colleague's published edit disappeared behind your own older one
 * with nothing on screen to explain it. Each source now has its own list, and a
 * level living in more than one place says so.
 */
export class MainMenu {
  private root: HTMLDivElement;
  private active: SourceId;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private disposed = false;

  constructor(private parent: HTMLElement, private opts: MenuOptions) {
    const sources = opts.library.available;
    this.active = sources[0]?.id ?? 'local';

    this.root = document.createElement('div');
    this.root.className = 'menu overlay';
    this.root.innerHTML = `
      <h1>Dog Chase Bones</h1>
      <div class="tabs"></div>
      <p class="tab-blurb"></p>
      <div class="menu-list">Loading…</div>
      <div class="menu-actions">
        <button class="btn" data-act="new">+ Create New Level</button>
        <button class="btn ghost" data-act="download" disabled>Download all</button>
      </div>`;

    const tabs = this.root.querySelector('.tabs')!;
    for (const source of sources) {
      const b = document.createElement('button');
      b.className = 'tab';
      b.dataset.src = source.id;
      b.innerHTML = `<span class="tab-label"></span><span class="tab-count"></span>`;
      b.querySelector('.tab-label')!.textContent = source.label;
      b.onclick = () => { this.active = source.id; this.render(); };
      tabs.appendChild(b);
    }

    this.root.querySelector('[data-act="new"]')!.addEventListener('click', () => {
      // A new level starts Local; moving it elsewhere is a deliberate copy.
      this.opts.onEdit(undefined, 'local');
    });
    this.root.querySelector('[data-act="download"]')!.addEventListener('click', (ev) =>
      this.downloadAll(ev.currentTarget as HTMLButtonElement));

    this.parent.appendChild(this.root);
    void this.load();
  }

  private async load() {
    await this.opts.library.refresh();
    if (this.disposed || !this.root.isConnected) return;
    this.render();
  }

  private render() {
    const lib = this.opts.library;

    this.root.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) => {
      const id = tab.dataset.src as SourceId;
      const listing = lib.listing(id);
      tab.classList.toggle('active', id === this.active);
      tab.classList.toggle('failed', Boolean(listing?.error));
      tab.querySelector('.tab-count')!.textContent =
        listing?.error ? '!' : String(listing?.levels.length ?? 0);
    });

    const listing = lib.listing(this.active);
    const source = lib.get(this.active);
    this.root.querySelector('.tab-blurb')!.textContent = source?.blurb ?? '';

    const list = this.root.querySelector<HTMLElement>('.menu-list')!;
    list.innerHTML = '';

    const download = this.root.querySelector<HTMLButtonElement>('[data-act="download"]')!;
    const count = listing?.levels.length ?? 0;
    download.disabled = count === 0;
    download.textContent = count ? `Download all (${count})` : 'Download all';

    if (listing?.error) {
      list.appendChild(this.note(`Could not read ${source?.label}: ${listing.error}`, 'bad'));
      return;
    }
    if (!listing || count === 0) {
      list.appendChild(this.note(this.emptyMessage(), 'plain'));
      return;
    }

    for (const level of listing.levels) list.appendChild(this.row(level));
  }

  private emptyMessage(): string {
    switch (this.active) {
      case 'local': return 'Nothing saved in this browser yet. Create a level, or copy one down from another tab.';
      case 'repo': return 'No level files in src/levels/published yet. Copy one here to put it under version control.';
      default: return 'Nothing published yet. Publish a level from the editor to share it with everyone.';
    }
  }

  private note(text: string, kind: 'plain' | 'bad'): HTMLElement {
    const p = document.createElement('p');
    p.className = `menu-empty${kind === 'bad' ? ' bad' : ''}`;
    p.textContent = text;
    return p;
  }

  private row(level: LevelData): HTMLElement {
    const lib = this.opts.library;
    const { spec } = parseLevel(level);
    const elsewhere = lib.alsoIn(level.id, this.active);

    const row = document.createElement('div');
    row.className = 'level-row';

    const card = document.createElement('button');
    card.className = 'level-card';
    card.innerHTML = `<span class="level-name"></span><span class="level-meta"></span>`;
    card.querySelector('.level-name')!.textContent = level.name;
    card.querySelector('.level-meta')!.textContent =
      `${spec.cols}x${spec.rows} · ${countDogs(spec)} dogs · ${countBones(spec)} bones · ${spec.timeLimit}s`;

    if (elsewhere.length) {
      // The thing that used to be invisible: this level lives in more than one
      // place, and saving here does not touch the others.
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = `also in ${elsewhere.join(', ')}`;
      card.querySelector('.level-name')!.appendChild(tag);
    }
    card.onclick = () => this.opts.onPlay(level);

    const ops = document.createElement('div');
    ops.className = 'level-ops';

    if (lib.canEdit(this.active)) {
      ops.appendChild(this.op('Edit', 'btn ghost small', () => this.opts.onEdit(level, this.active)));
    }
    for (const target of lib.copyTargets(this.active)) {
      ops.appendChild(this.op(`→ ${target.label}`, 'btn ghost small', () => void this.copy(level, target.id)));
    }
    if (lib.canDelete(this.active)) {
      ops.appendChild(this.op('Delete', 'btn ghost small danger', () => void this.remove(level)));
    }

    row.append(card, ops);
    return row;
  }

  private op(text: string, className: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = className;
    b.textContent = text;
    b.onclick = onClick;
    return b;
  }

  private async copy(level: LevelData, targetId: SourceId) {
    const target = this.opts.library.get(targetId);
    if (!target?.save) return;

    const existing = this.opts.library.listing(targetId)?.levels.some((l) => l.id === level.id);
    if (existing && !confirm(`${target.label} already has "${level.name}". Overwrite it?`)) return;

    try {
      // Same id on purpose: a copy is the same level in another place, so
      // publishing it later replaces rather than duplicates.
      await target.save(structuredClone(level));
      await this.load();
    } catch (err) {
      alert(`Could not copy to ${target.label}: ${describe(err)}`);
    }
  }

  private async remove(level: LevelData) {
    const source = this.opts.library.get(this.active);
    if (!source?.remove) return;
    if (!confirm(`Delete "${level.name}" from ${source.label}?`)) return;

    try {
      await source.remove(level);
      await this.load();
    } catch (err) {
      alert(`Could not delete: ${describe(err)}`);
    }
  }

  private downloadAll(btn: HTMLButtonElement) {
    const levels = this.opts.library.listing(this.active)?.levels ?? [];
    if (!levels.length) return;

    btn.disabled = true;
    let done = 0;

    levels.forEach((level, i) => {
      // Staggered: browsers quietly drop a burst fired in one tick, and the
      // first of a batch raises a permission prompt that has to be answered.
      this.timers.push(setTimeout(() => {
        if (this.disposed || !this.root.isConnected) return;
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
            if (this.disposed || !this.root.isConnected) return;
            btn.disabled = false;
            btn.textContent = `Download all (${levels.length})`;
          }, 2500));
        }
      }, i * 140));
    });
  }

  dispose() {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.root.remove();
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
