import { MainMenu } from './ui/MainMenu';
import { GameApp } from './game/GameApp';
import { EditorApp } from './editor/EditorApp';
import { LevelLibrary } from './levels/library';
import { LocalSource } from './levels/sources/local';
import { RepoSource } from './levels/sources/repo';
import { ServerSource } from './levels/sources/server';
import type { SourceId } from './levels/sources/types';
import { PROTOTYPE } from './config';
import type { LevelData } from './shared/types';

const appEl = document.getElementById('app')!;

// Three sources, listed separately and never merged. Repo is available only
// under the dev server, which is where the middleware that writes files lives.
const library = new LevelLibrary([
  new LocalSource(PROTOTYPE),
  new RepoSource(),
  new ServerSource(PROTOTYPE),
]);

let current: { dispose(): void } | undefined;
function clearApp() { current?.dispose(); current = undefined; }

let navSeq = 0;

function showMenu() {
  clearApp();
  navSeq++;
  current = new MainMenu(appEl, {
    library,
    onPlay: (lv) => showGame(lv),
    onEdit: (lv, source) => showEditor(lv, source),
  });
}

async function showGame(level: LevelData, back?: { level: LevelData; source: SourceId }) {
  clearApp();
  const seq = ++navSeq;
  const g = await GameApp.create(appEl, {
    level,
    onMenu: () => (back ? showEditor(back.level, back.source) : showMenu()),
    onWin: () => { /* the win banner is GameApp's own UX */ },
  });
  if (seq !== navSeq) { g.dispose(); return; }  // superseded by a newer navigation
  current = g;
}

async function showEditor(initial: LevelData | undefined, source: SourceId) {
  clearApp();
  const seq = ++navSeq;
  const e = await EditorApp.create(appEl, {
    library, source, prototype: PROTOTYPE, initial,
    onExit: () => showMenu(),
    onTest: (lv) => showGame(lv, { level: lv, source }),
  });
  if (seq !== navSeq) { e.dispose(); return; }  // superseded by a newer navigation
  current = e;
}

showMenu();
