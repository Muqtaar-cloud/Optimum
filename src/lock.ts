import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Takes the single-instance lock. Returns false if another live bot holds it.
 * Must run before anything touches the browser profile.
 */
export function acquireLock(pidPath: string, pid = process.pid, alive = isAlive): boolean {
  if (existsSync(pidPath)) {
    const other = Number(readFileSync(pidPath, 'utf8').trim());
    if (Number.isInteger(other) && other > 0 && other !== pid && alive(other)) return false;
  }
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, String(pid));
  return true;
}

export function releaseLock(pidPath: string, pid = process.pid): void {
  if (existsSync(pidPath) && readFileSync(pidPath, 'utf8').trim() === String(pid)) rmSync(pidPath);
}

/** Chrome's own profile locks, left behind by a crash. Only safe to remove while holding our lock. */
export function clearChromeLocks(profileDir: string): void {
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile']) {
    rmSync(join(profileDir, f), { force: true });
  }
}
