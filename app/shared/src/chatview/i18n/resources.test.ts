// real_tested=true
import { describe, expect, it } from 'vitest';

import { CHATVIEW_I18N_NAMESPACE, chatviewResources } from './resources';
import type { Locale } from './resources';

// ── Helpers ───────────────────────────────────────────────────────────

const LOCALES: Locale[] = ['zh', 'en'];

/**
 * i18next plural suffixes. English cardinal plurals require `_one`/`_other`
 * resource keys; zh (which has no plural rule) uses the bare base key
 * instead. `zero|two|few|many` are included for completeness.
 */
const PLURAL_SUFFIX_PATTERN = /_(zero|one|two|few|many|other)$/;

/**
 * Strips a trailing i18next plural suffix so that
 * `agentStreaming.toolCalls_one` and `agentStreaming.toolCalls` map to the
 * same logical key. The suffix must be preceded by an underscore, so a
 * regular key like `subagentStream.cat.other` is left untouched.
 */
function logicalKey(key: string): string {
  return key.replace(PLURAL_SUFFIX_PATTERN, '');
}

function isPluralKey(key: string): boolean {
  return PLURAL_SUFFIX_PATTERN.test(key);
}

/**
 * Recursively flattens a (possibly nested) translation map into dot-path
 * leaves. The current resources are flat string maps, but walking
 * recursively keeps these checks valid if a locale is ever nested.
 */
function flattenLeaves(node: unknown, prefix: string, out: Map<string, unknown>): void {
  if (typeof node === 'string') {
    out.set(prefix, node);
    return;
  }
  if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
    for (const [segment, child] of Object.entries(node)) {
      const path = prefix === '' ? segment : `${prefix}.${segment}`;
      flattenLeaves(child, path, out);
    }
    return;
  }
  // Non-string leaf — flagged by the structure tests.
  out.set(prefix, node);
}

function leavesOf(locale: Locale): Map<string, unknown> {
  const leaves = new Map<string, unknown>();
  flattenLeaves(chatviewResources[locale], '', leaves);
  return leaves;
}

/**
 * Extracts interpolation placeholder names from a translation value,
 * accepting both i18next's `{{name}}` form and the single-brace `{name}`
 * form used elsewhere in the resources.
 */
function extractPlaceholderNames(value: string): string[] {
  const names = new Set<string>();
  const placeholderPattern = /\{\{([A-Za-z0-9]+)\}\}|\{([A-Za-z0-9]+)\}/g;
  for (const match of value.matchAll(placeholderPattern)) {
    const name = match[1] ?? match[2];
    if (name !== undefined) names.add(name);
  }
  return [...names].sort();
}

const ZH_LEAVES = leavesOf('zh');
const EN_LEAVES = leavesOf('en');

/** Base keys of the plural forms declared in en (e.g. `agentStreaming.toolCalls`). */
const EN_PLURAL_BASES = new Set(
  [...EN_LEAVES.keys()].filter(isPluralKey).map(logicalKey),
);

/** Flat dot-separated identifiers, e.g. `card.think.running`. */
const FLAT_KEY_PATTERN = /^[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$/;

// ── Namespace constant ────────────────────────────────────────────────

describe('CHATVIEW_I18N_NAMESPACE', () => {
  it('is the documented chatview namespace identifier', () => {
    expect(CHATVIEW_I18N_NAMESPACE).toBe('chatview');
    expect(CHATVIEW_I18N_NAMESPACE.length).toBeGreaterThan(0);
  });
});

// ── Export structure ──────────────────────────────────────────────────

describe('chatviewResources export structure', () => {
  it('exposes exactly the zh and en locale maps', () => {
    expect(Object.keys(chatviewResources).sort()).toEqual(['en', 'zh']);
  });

  it('stores every locale value as non-empty string leaves', () => {
    for (const locale of LOCALES) {
      const leaves = leavesOf(locale);
      expect(leaves.size, `${locale} has no keys`).toBeGreaterThan(0);
      const nonStringLeaves = [...leaves.entries()]
        .filter(([, value]) => typeof value !== 'string')
        .map(([key]) => `${locale}.${key}`);
      expect(nonStringLeaves).toEqual([]);
    }
  });

  it('defines a sizable key set per locale', () => {
    // Guards against accidental truncation of the resource maps.
    for (const locale of LOCALES) {
      expect(leavesOf(locale).size).toBeGreaterThanOrEqual(200);
    }
  });
});

// ── zh/en key-set parity ──────────────────────────────────────────────

describe('key-set parity across locales', () => {
  it('every en key has a zh counterpart (plural-aware)', () => {
    const missingInZh = [...new Set([...EN_LEAVES.keys()].map(logicalKey))]
      .filter((key) => !ZH_LEAVES.has(key))
      .sort();
    expect(missingInZh).toEqual([]);
  });

  it('every zh key has an en counterpart (plural-aware)', () => {
    const missingInEn = [...ZH_LEAVES.keys()]
      .filter((key) => !EN_LEAVES.has(key) && !EN_PLURAL_BASES.has(key))
      .sort();
    expect(missingInEn).toEqual([]);
  });
});

// ── i18next plural conventions ────────────────────────────────────────

describe('i18next plural key conventions', () => {
  it('zh keeps bare base keys and never uses plural suffixes', () => {
    const zhPluralKeys = [...ZH_LEAVES.keys()].filter(isPluralKey).sort();
    expect(zhPluralKeys).toEqual([]);
  });

  it('every en plural base declares the complete one/other pair and a zh base key', () => {
    for (const base of [...EN_PLURAL_BASES].sort()) {
      expect(EN_LEAVES.has(`${base}_one`), `missing en key ${base}_one`).toBe(true);
      expect(EN_LEAVES.has(`${base}_other`), `missing en key ${base}_other`).toBe(true);
      expect(ZH_LEAVES.has(base), `missing zh base key ${base}`).toBe(true);
    }
  });
});

// ── Value hygiene ─────────────────────────────────────────────────────

describe('translation value hygiene', () => {
  it('contains no empty-string values', () => {
    const emptyKeys: string[] = [];
    for (const locale of LOCALES) {
      for (const [key, value] of leavesOf(locale)) {
        if (typeof value === 'string' && value.length === 0) {
          emptyKeys.push(`${locale}.${key}`);
        }
      }
    }
    expect(emptyKeys).toEqual([]);
  });

  it('contains no whitespace-only values', () => {
    const blankKeys: string[] = [];
    for (const locale of LOCALES) {
      for (const [key, value] of leavesOf(locale)) {
        if (typeof value === 'string' && value.trim().length === 0) {
          blankKeys.push(`${locale}.${key}`);
        }
      }
    }
    expect(blankKeys).toEqual([]);
  });
});

// ── Key format ────────────────────────────────────────────────────────

describe('translation key format', () => {
  it('uses flat dot-separated identifier keys', () => {
    const malformedKeys: string[] = [];
    for (const locale of LOCALES) {
      for (const key of leavesOf(locale).keys()) {
        // Plural suffixes are validated separately; the base must still be
        // a flat dot-separated identifier.
        if (!FLAT_KEY_PATTERN.test(logicalKey(key))) {
          malformedKeys.push(`${locale}.${key}`);
        }
      }
    }
    expect(malformedKeys).toEqual([]);
  });
});

// ── Interpolation placeholders ────────────────────────────────────────

describe('interpolation placeholder consistency', () => {
  it('zh and en reference the same placeholders for each shared key', () => {
    const mismatches: string[] = [];
    for (const key of ZH_LEAVES.keys()) {
      const zhValue = ZH_LEAVES.get(key);
      const enValue =
        EN_LEAVES.get(key) ?? EN_LEAVES.get(`${key}_other`) ?? EN_LEAVES.get(`${key}_one`);
      if (typeof zhValue !== 'string' || typeof enValue !== 'string') continue;
      const zhPlaceholders = extractPlaceholderNames(zhValue).join(',');
      const enPlaceholders = extractPlaceholderNames(enValue).join(',');
      if (zhPlaceholders !== enPlaceholders) {
        mismatches.push(`${key}: zh=[${zhPlaceholders}] en=[${enPlaceholders}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

// #2241: `UNAVAILABLE_ACTION_TOAST_KEY` ('toast.actionUnavailable') is the copy
// the transcript effect dispatcher announces when a shell never wired the port
// behind a planned action. Before this key existed the dispatcher fell back to
// each effect's own failure copy ("置顶失败，请重试"), which promises a retry
// that can never succeed on that client. These assertions pin the dedicated
// copy in both locales: the wording *is* the deliverable here, so it is
// asserted literally (the dispatcher-side behaviour is covered by
// app/workbench/src/__tests__/unavailableActionToastI18n.test.ts).
describe('toast.actionUnavailable (#2241)', () => {
  const KEY = 'toast.actionUnavailable';

  it('ships the dedicated unwired-action copy in zh and en', () => {
    expect(chatviewResources.zh[KEY]).toBe('该操作在当前端未接入');
    expect(chatviewResources.en[KEY]).toBe('This action is not wired in this client');
  });

  it('does not promise a retry the client can never honour', () => {
    expect(chatviewResources.zh[KEY]).not.toContain('重试');
    expect(chatviewResources.en[KEY]).not.toMatch(/retry|again/i);
  });

  it('is reachable through the chatview namespace the dispatcher translates in', () => {
    // The dispatcher's `t` comes from useTranslation(CHATVIEW_I18N_NAMESPACE),
    // so the key must live in this bundle (not the sharedWorkbench one).
    expect(CHATVIEW_I18N_NAMESPACE).toBe('chatview');
    expect(Object.keys(chatviewResources.zh)).toContain(KEY);
    expect(Object.keys(chatviewResources.en)).toContain(KEY);
  });
});
