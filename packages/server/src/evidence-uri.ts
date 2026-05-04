import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, normalize, relative, resolve } from 'node:path';

function isUncPath(p: string): boolean {
  const n = p.replace(/\//g, '\\');
  return n.startsWith('\\\\');
}

/** Relative path must stay inside root: non-empty, not '..', no UNC-like absolute segments. */
function relativeContained(rootAbs: string, targetAbs: string): boolean {
  const rel = relative(rootAbs, targetAbs);
  const normRel = rel.replace(/\\/g, '/');
  if (!normRel || normRel === '.') return true;
  if (isAbsolute(rel)) return false;
  if (normRel.startsWith('../') || normRel === '..') return false;
  if (normRel.startsWith('//')) return false;
  return true;
}

/**
 * Returns null if allowed; otherwise a short machine-readable reason.
 * Allowed: https; http only for localhost / 127.0.0.1; file only under repo root (real path, must exist).
 */
export function checkEvidenceUri(uri: string, repoRoot: string): string | null {
  const t = uri.trim();
  if (!t) return 'empty_uri';
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return 'invalid_uri';
  }
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) {
    return null;
  }
  if (u.protocol === 'file:') {
    let fsPath: string;
    try {
      fsPath = fileURLToPath(u);
    } catch {
      return 'invalid_file_uri';
    }
    if (!isAbsolute(fsPath)) {
      fsPath = resolve(repoRoot, fsPath);
    }
    const rootAbs = resolve(normalize(repoRoot));
    const abs = resolve(normalize(fsPath));

    if (isUncPath(abs)) return 'file_outside_repo';

    if (process.platform === 'win32') {
      const r0 = rootAbs.charAt(0);
      const a0 = abs.charAt(0);
      if (/[A-Za-z]/.test(r0) && /[A-Za-z]/.test(a0)) {
        if (rootAbs.slice(0, 2).toLowerCase() !== abs.slice(0, 2).toLowerCase()) {
          return 'file_outside_repo';
        }
      }
    }

    let rootReal: string;
    let targetReal: string;
    try {
      rootReal = realpathSync.native(rootAbs);
    } catch {
      return 'repo_root_inaccessible';
    }
    try {
      targetReal = realpathSync.native(abs);
    } catch {
      return 'file_not_found';
    }

    if (isUncPath(targetReal)) return 'file_outside_repo';

    if (process.platform === 'win32') {
      const r0 = rootReal.charAt(0);
      const a0 = targetReal.charAt(0);
      if (/[A-Za-z]/.test(r0) && /[A-Za-z]/.test(a0)) {
        if (rootReal.slice(0, 2).toLowerCase() !== targetReal.slice(0, 2).toLowerCase()) {
          return 'file_outside_repo';
        }
      }
    }

    if (!relativeContained(rootReal, targetReal)) return 'file_outside_repo';
    return null;
  }
  return 'scheme_not_allowed';
}
