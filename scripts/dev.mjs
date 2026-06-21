import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import waitOn from 'wait-on';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let shuttingDown = false;
let shutdownCode = 0;
const children = new Set();

function terminateChildren() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownCode = code;
  terminateChildren();

  if (children.size === 0) {
    process.exit(shutdownCode);
  }
}

function handleChildExit(childName, code, signal) {
  if (shuttingDown) {
    if (children.size === 0) process.exit(shutdownCode);
    return;
  }

  const exitCode = typeof code === 'number' ? code : (signal ? 1 : 0);
  console.log(`[dev] ${childName} exited with code ${exitCode}${signal ? ` (${signal})` : ''}`);
  shutdown(exitCode);
}

function spawnNpm(childName, args, extraEnv = {}) {
  const child = spawn(npmExecutable, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    handleChildExit(childName, code, signal);
  });

  return child;
}

function isPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer();

    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen({ port, host: '127.0.0.1', exclusive: true });
  });
}

async function findAvailablePort(startPort, maxAttempts = 50) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = startPort + offset;
    if (await isPortAvailable(port)) return port;
  }

  throw new Error(`Unable to find an available port starting from ${startPort}`);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const rendererPort = await findAvailablePort(5173);
const rendererUrl = `http://127.0.0.1:${rendererPort}`;

console.log(`[dev] starting renderer on ${rendererUrl}`);

spawnNpm('renderer', ['run', 'dev:renderer', '--', '--host', '127.0.0.1', '--port', String(rendererPort), '--strictPort'], { NODE_OPTIONS: '--no-warnings' });
spawnNpm('main', ['run', 'dev:main'], { NODE_OPTIONS: '--no-warnings' });

try {
  await waitOn({
    resources: [
      `http-get://127.0.0.1:${rendererPort}`,
      `file:${path.join(projectRoot, 'dist/main/index.js')}`,
    ],
    delay: 100,
    interval: 150,
    timeout: 60_000,
  });
} catch (error) {
  console.error('[dev] failed to start development services');
  console.error(error);
  shutdown(1);
}

if (!shuttingDown) {
  spawnNpm('electron', ['run', 'dev:electron'], {
    NODE_ENV: 'development',
    VITE_DEV_SERVER_PORT: String(rendererPort),
    VITE_DEV_SERVER_URL: rendererUrl,
  });
}