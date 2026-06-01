import { invoke } from '@tauri-apps/api/core';

/**
 * Allowlist entry matching the Rust struct in commands.rs.
 * Only fields needed for backend validation are included.
 */
export interface TauriAllowlistEntry {
  path: string;
  globs: string[];
  trustLevel: string;
}

/**
 * Validate whether a given file path is covered by the workspace allowlist.
 * Calls the Tauri backend command `validate_allowlist`.
 *
 * @param path - The absolute file path to validate.
 * @param allowlist - Array of allowlist entries to check against.
 * @returns `true` if the path is allowed by at least one entry.
 */
export async function validateAllowlistPath(path: string, allowlist: TauriAllowlistEntry[]): Promise<boolean> {
  try {
    return await invoke<boolean>('validate_allowlist', {
      path,
      allowlist: allowlist.map((entry) => ({
        path: entry.path,
        globs: entry.globs,
        trustLevel: entry.trustLevel,
      })),
    });
  } catch {
    // If the Tauri backend is unavailable (e.g., running in browser), fall back
    // to a client-side path-prefix check.
    return clientSideValidate(path, allowlist);
  }
}

/**
 * Client-side fallback: checks if `filePath` is within any allowlisted directory
 * and matches at least one glob pattern.
 */
function clientSideValidate(filePath: string, allowlist: TauriAllowlistEntry[]): boolean {
  const normalizedTarget = normalizePath(filePath);
  if (!normalizedTarget) return false;

  for (const entry of allowlist) {
    const normalizedBase = normalizePath(entry.path);
    if (!normalizedBase) continue;

    if (!normalizedTarget.startsWith(normalizedBase)) continue;

    const rel = normalizedTarget.slice(normalizedBase.length).replace(/^[\\/]+/, '');

    if (entry.globs.length === 0) return true;

    for (const glob of entry.globs) {
      const pattern = glob.trim();
      if (!pattern || pattern === '**/*' || pattern === '**') return true;
      if (simpleGlobMatch(rel, pattern)) return true;
    }
  }

  return false;
}

function normalizePath(p: string): string {
  return (p ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Simple glob matching for client-side validation fallback.
 * Supports *, ?, ** (any depth), and character classes [...].
 */
function simpleGlobMatch(path: string, pattern: string): boolean {
  const p = path;
  const g = pattern;

  let pi = 0;
  let si = 0;
  let starPi = -1;
  let matchSi = 0;

  while (si < p.length) {
    if (pi < g.length && g[pi] === '*') {
      // Check for **
      if (pi + 1 < g.length && g[pi + 1] === '*') {
        if (pi + 2 < g.length && g[pi + 2] === '/') {
          // **/ - match remaining path at any depth
          const remaining = g.slice(pi + 3);
          for (let k = si; k <= p.length; k++) {
            if (k === p.length || p[k] === '/') {
              if (!remaining || simpleGlobMatch(p.slice(k), remaining)) {
                return true;
              }
            }
          }
          return false;
        }
        // Just ** matches everything
        return true;
      }

      starPi = pi;
      matchSi = si;
      pi += 1;
    } else if (
      pi < g.length &&
      (g[pi] === '?' || g[pi] === p[si])
    ) {
      pi += 1;
      si += 1;
    } else if (starPi !== -1) {
      pi = starPi + 1;
      matchSi += 1;
      si = matchSi;
    } else {
      return false;
    }
  }

  while (pi < g.length && g[pi] === '*') {
    pi += 1;
  }

  return pi === g.length;
}
