import { MainMenu } from './ui/MainMenu';
import { GameApp } from './game/GameApp';
import { EditorApp } from './editor/EditorApp';
import { LevelStore } from './levels/store';
import { SupabaseBackend } from './levels/supabaseBackend';
import { LocalDraftBackend } from './levels/localBackend';
import { BUILTIN_LEVELS } from './levels/builtin';
import { PUBLISHED_LEVELS } from './levels/published';
import { PROTOTYPE, HAS_BACKEND } from './config';
import type { LevelData } from './shared/types';

const appEl = document.getElementById('app')!;
const backend = HAS_BACKEND ? new SupabaseBackend() : new LocalDraftBackend(PROTOTYPE);
const store = new LevelStore(PROTOTYPE, backend, [...BUILTIN_LEVELS, ...PUBLISHED_LEVELS]);

let current: { dispose(): void } | undefined;
function clearApp() { current?.dispose(); current = undefined; }

let navSeq = 0;

function showMenu() {
  clearApp();
  navSeq++;
  current = new MainMenu(appEl, {
    store,
    onPlay: (lv) => showGame(lv),
    onEdit: (lv) => showEditor(lv),
  });
}

async function showGame(level: LevelData, returnToEditor?: LevelData) {
  clearApp();
  const seq = ++navSeq;
  const g = await GameApp.create(appEl, {
    level,
    onMenu: () => (returnToEditor ? showEditor(returnToEditor) : showMenu()),
    onWin: () => { /* the win banner is GameApp's own UX */ },
  });
  if (seq !== navSeq) { g.dispose(); return; }  // superseded by a newer navigation
  current = g;
}

async function showEditor(initial?: LevelData) {
  clearApp();
  const seq = ++navSeq;
  const e = await EditorApp.create(appEl, {
    store, prototype: PROTOTYPE, initial,
    onExit: () => showMenu(),
    onTest: (lv) => showGame(lv, lv),
  });
  if (seq !== navSeq) { e.dispose(); return; }  // superseded by a newer navigation
  current = e;
}

showMenu();
