/**
 * @acp/server — HTTP API for Agent Control Plane (memory store v0.1).
 */
import path, { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { AcpStore } from './store.js';
import { registerRoutes } from './routes.js';
import { initProtocolValidators } from './validators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = process.env.ACP_REPO_ROOT ?? join(__dirname, '..', '..', '..');

const isMainModule =
  Boolean(process.argv[1]) && path.resolve(__filename) === path.resolve(process.argv[1] as string);

export async function buildServer() {
  initProtocolValidators(repoRoot);
  const app = Fastify({ logger: true });
  const store = new AcpStore(repoRoot);
  await registerRoutes(app, store);
  return app;
}

async function main() {
  const app = await buildServer();
  const port = Number(process.env.PORT ?? 3840);
  await app.listen({ port, host: '127.0.0.1' });
}

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
