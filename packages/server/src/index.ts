/**
 * @acp/server — HTTP API for Agent Control Plane (SQLite persistence).
 */
import path, { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { DEFAULT_DATA_DIR, openAcpDatabase } from './db.js';
import { AcpStore } from './store.js';
import { registerRoutes } from './routes.js';
import { initProtocolValidators } from './validators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = process.env.ACP_REPO_ROOT ?? join(__dirname, '..', '..', '..');

const isMainModule =
  Boolean(process.argv[1]) && path.resolve(__filename) === path.resolve(process.argv[1] as string);

export function resolveDataDir(): string {
  const raw = process.env.ACP_DATA_DIR;
  if (raw) return path.isAbsolute(raw) ? raw : join(repoRoot, raw);
  return join(repoRoot, DEFAULT_DATA_DIR);
}

export async function buildServer(opts?: { logger?: boolean }) {
  initProtocolValidators(repoRoot);
  const dataDir = resolveDataDir();
  mkdirSync(dataDir, { recursive: true });
  const db = openAcpDatabase(dataDir);
  try {
    const app = Fastify({ logger: opts?.logger ?? false });
    const apiToken = process.env.ACP_API_TOKEN?.trim();
    if (apiToken) {
      app.addHook('onRequest', async (req, reply) => {
        const pathOnly = req.url.split('?')[0] ?? '';
        if (!pathOnly.startsWith('/api')) return;
        if (pathOnly === '/api/health') return;
        const auth = req.headers.authorization;
        if (!auth || auth !== `Bearer ${apiToken}`) {
          return reply.code(401).send({ error: 'unauthorized', detail: 'Valid Bearer token required' });
        }
      });
    }
    const store = new AcpStore(repoRoot, db);
    app.addHook('onClose', async () => {
      db.close();
    });
    await registerRoutes(app, store);
    return app;
  } catch (err) {
    db.close();
    throw err;
  }
}

async function main() {
  const app = await buildServer({ logger: true });
  const port = Number(process.env.PORT ?? 3840);
  await app.listen({ port, host: '127.0.0.1' });
}

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
