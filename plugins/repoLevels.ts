import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { formatLevelJson } from '../src/levels/serialize';
import type { LevelData } from '../src/shared/types';

const ENDPOINT = '/__repo-levels';
const DIR = 'src/levels/published';
const SAFE_FILE = /^[a-z0-9][a-z0-9-]*\.json$/;

/**
 * Lets the in-game editor read and write the level files in src/levels/published.
 *
 * A browser cannot touch the disk, so this middleware does it on the browser's
 * behalf. It is installed by `configureServer`, which runs only under
 * `npm run dev` -- so the deployed build has no such endpoint and the editor's
 * Repo tab is simply absent there. That is the enforcement, not a flag.
 *
 * Everything written is an ordinary file: git sees it, the designer commits and
 * reverts it like any other change.
 */
export function repoLevels(): Plugin {
  return {
    name: 'reboot:repo-levels',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const dir = resolve(server.config.root, DIR);

      server.middlewares.use(ENDPOINT, (req, res) => {
        void handle(req, res, dir).catch((err: unknown) => {
          send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        });
      });
    },
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, dir: string) {
  const method = req.method ?? 'GET';

  if (method === 'GET') return send(res, 200, await listLevels(dir));

  if (method === 'PUT') {
    const body = await readBody(req);
    const file = String(body.file ?? '');
    if (!safe(file)) return send(res, 400, { error: `unsafe filename: ${file}` });
    if (typeof body.level !== 'object' || body.level === null) {
      return send(res, 400, { error: 'missing level' });
    }

    // A fresh clone has no published/ directory until the first level is written.
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, file), `${formatLevelJson(body.level as LevelData)}\n`, 'utf8');

    // A rename moves the file rather than leaving the old one orphaned.
    const previous = typeof body.previousFile === 'string' ? body.previousFile : '';
    if (previous && previous !== file && safe(previous)) {
      await unlink(join(dir, previous)).catch(() => {});
    }
    return send(res, 200, { file });
  }

  if (method === 'DELETE') {
    const file = new URL(req.url ?? '', 'http://localhost').searchParams.get('file') ?? '';
    if (!safe(file)) return send(res, 400, { error: `unsafe filename: ${file}` });
    await unlink(join(dir, file)).catch(() => {});
    return send(res, 200, { file });
  }

  send(res, 405, { error: `${method} not allowed` });
}

async function listLevels(dir: string) {
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((f) => f.endsWith('.json'))
    .sort();

  const rows = [];
  for (const file of names) {
    try {
      rows.push({ file, level: JSON.parse(await readFile(join(dir, file), 'utf8')) as unknown });
    } catch (err) {
      // A hand-edited file with a typo should not take the whole tab down.
      console.warn(`[repo-levels] skipping ${file}:`, err);
    }
  }
  return rows;
}

/** Only a bare kebab-case .json name: no slashes, no dots, no traversal. */
function safe(file: string): boolean {
  return SAFE_FILE.test(file);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
