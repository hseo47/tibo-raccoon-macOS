import * as actual from 'node:fs/promises';
import { join } from 'node:path';
import { mock } from 'bun:test';

const original = {
  chmod: actual.chmod,
  link: actual.link,
  lstat: actual.lstat,
  mkdir: actual.mkdir,
  open: actual.open,
  readFile: actual.readFile,
  readdir: actual.readdir,
  realpath: actual.realpath,
  rename: actual.rename,
  stat: actual.stat,
  unlink: actual.unlink,
  writeFile: actual.writeFile,
};

const [fault, directory] = process.argv.slice(2);
if (fault === undefined || directory === undefined) process.exit(64);

const canonicalDirectory = await actual.realpath(directory);
const stateFile = join(canonicalDirectory, 'state.json');
const lockFile = join(canonicalDirectory, 'state.lock');
const resultFile = join(canonicalDirectory, 'fault-result.json');
let renamed = false;
let quarantined = false;
let fired = false;

function failOnce(kind: string): never {
  fired = true;
  throw Object.assign(new Error(`fault:${kind}`), { code: 'EIO' });
}

mock.module('node:fs/promises', () => ({
  mkdir: original.mkdir,
  lstat: original.lstat,
  readFile: original.readFile,
  readdir: original.readdir,
  realpath: original.realpath,
  stat: original.stat,
  unlink: original.unlink,
  link: async (from: string, to: string) => {
    await original.link(from, to);
    if (fault === 'crash-reclaim-claim' && to === `${lockFile}.reclaim`) process.exit(87);
  },
  open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await original.open(...args);
    const path = String(args[0]);
    if (fault === 'crash-primary-create' && (path === lockFile || path.startsWith(`${lockFile}.owner-`))) process.exit(86);
    if (!fired && quarantined && fault === 'recovery-after-quarantine' && path.startsWith(`${stateFile}.tmp-`)) {
      await handle.close();
      await original.unlink(path);
      failOnce(fault);
    }
    return new Proxy(handle, {
      get(target, property, receiver) {
        if (!fired && path === `${lockFile}.reclaim` && property === 'sync' && fault === 'crash-reclaim-claim') {
          return async () => {
            await target.sync();
            process.exit(87);
          };
        }
        const primaryOwnerTemporary = path.startsWith(`${lockFile}.owner-`);
        if (!fired && (path === lockFile || primaryOwnerTemporary) && property === 'writeFile' && fault === 'lock-write') return async () => failOnce(fault);
        if (!fired && (path === lockFile || primaryOwnerTemporary) && property === 'sync' && fault === 'lock-sync') return async () => failOnce(fault);
        if (!fired && (path === lockFile || primaryOwnerTemporary) && property === 'close' && fault === 'lock-close') return async () => failOnce(fault);
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  },
  rename: async (from: string, to: string) => {
    if (from === stateFile && to.includes('.corrupt-')) quarantined = true;
    if (!fired && from.startsWith(`${stateFile}.tmp-`) && to === stateFile && fault === 'before-rename') failOnce(fault);
    if (from.startsWith(`${stateFile}.tmp-`) && to === stateFile && fault === 'observe-temp') {
      await original.writeFile(join(canonicalDirectory, 'temp-ready'), 'ready');
      while (true) {
        try { await original.stat(join(canonicalDirectory, 'temp-release')); break; } catch { await Bun.sleep(5); }
      }
    }
    return original.rename(from, to).then(() => { if (to === stateFile) renamed = true; });
  },
  chmod: async (path: string, mode: number) => {
    if (!fired && fault === 'post-rename-chmod' && renamed && path === stateFile) failOnce(fault);
    return original.chmod(path, mode);
  },
}));

const store = await import('../../src/state/store');
const paths = { directory: canonicalDirectory, stateFile, lockFile };
let threw = false;
let message = '';
try {
  if (fault === 'recovery-after-quarantine') {
    await original.writeFile(stateFile, '{broken', { mode: 0o600 });
    // Fail the recovery replacement temporary open after the corrupt bytes have moved.
    await store.loadState(paths);
  } else {
    await original.writeFile(stateFile, `${JSON.stringify({ version: 1, initializedAt: null, recoveryPending: false, knownIds: ['old'], unreadIds: [], cachedPosts: [], lastAttemptAt: null, lastSuccessAt: null, consecutiveFailures: 0, nextRetryAt: null, lastError: null })}\n`, { mode: 0o600 });
    await store.mutateState(paths, (current) => ({ ...current, knownIds: ['new'] }));
  }
} catch (error) {
  threw = true;
  message = error instanceof Error ? error.message : '';
}
await original.writeFile(resultFile, JSON.stringify({ threw, message, fired, quarantined, renamed }));
