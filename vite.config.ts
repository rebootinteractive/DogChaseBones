import { defineConfig } from 'vite';
import { repoLevels } from './plugins/repoLevels';

export default defineConfig({
  // repoLevels is dev-only (apply: 'serve'), which is what makes the editor's
  // Repo tab available locally and absent from the deployed build.
  plugins: [repoLevels()],
  base: './',
  server: { port: 5173 },
  build: { target: 'es2022' },
});
