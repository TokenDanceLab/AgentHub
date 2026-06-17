# 1) Fix setup.ts — add clean react-i18next mock
with open('app/shared/src/__tests__/setup.ts', 'r', encoding='utf-8') as f:
    content = f.read()

mock_block = """
/* ── Global mock for react-i18next — avoids per-file vi.mock hoisting
     issues when dependencies (e.g. ChatViewTranscript) transitively
     import react-i18next during module evaluation.  Collects keys
     lazily from sharedWorkbenchResources + chatviewResources at
     first t() call so no top-level imports are referenced inside
     the mock factory. ── */

const { __i18nMockRef } = vi.hoisted(() => ({ __i18nMockRef: { ready: false, map: {} as Record<string, string> } }));

function __lazyI18nFill() {
  if (__i18nMockRef.ready) return;
  try {
    const wb = require('../i18n/workbench');
    const cv = require('../chatview/i18n/resources');
    (function c(r: any, p = '') {
      for (const [k, v] of Object.entries(r)) {
        const n = p ? p + '.' + k : k;
        if (typeof v === 'string') __i18nMockRef.map[n] = v;
        else if (v && typeof v === 'object') c(v, n);
      }
    })(wb.sharedWorkbenchResources.zh);
    (function c2(r: any, p = '') {
      for (const [k, v] of Object.entries(r)) {
        const n2 = p ? p + '.' + k : k;
        if (typeof v === 'string') __i18nMockRef.map[n2] = v;
        else if (v && typeof v === 'object') c2(v, n2);
      }
    })(cv.chatviewResources.zh);
    __i18nMockRef.ready = true;
  } catch { /* setup file may not have access to these modules */ }
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      __lazyI18nFill();
      const translations: Record<string, string> = {
        ...__i18nMockRef.map,
        'composer.placeholder': '发消息给 {{target}}',
        'composer.send': '发送消息',
        'nav.contacts': '联系人',
      };
      const base = translations[key];
      if (base === undefined) return key;
      if (options) {
        return base.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) =>
          String(options[name] ?? options[name.toLowerCase()] ?? '{{${name}}}'));
      }
      return base;
    },
    i18n: { language: 'zh' },
  }),
}));
"""

content = content.replace(
    "import '@testing-library/jest-dom/vitest';\nimport { vi } from 'vitest';",
    "import '@testing-library/jest-dom/vitest';\nimport { vi } from 'vitest';" + mock_block
)

with open('app/shared/src/__tests__/setup.ts', 'w', encoding='utf-8') as f:
    f.write(content)

# 2) Fix test file — remove the vi.mock('react-i18next') block and its imports
with open('app/shared/src/workbench/AgentHubWorkbench.test.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the vi.mock('react-i18next') line and ending });
start = None
end = None
for i, line in enumerate(lines):
    if line.strip().startswith("vi.mock('react-i18next'"):
        start = i
    if start is not None and line.strip() == '});' and i > start + 5:
        end = i
        break

if start is not None and end is not None:
    # Remove lines start..end (inclusive), and also the two import lines before
    lines_to_remove = set()
    for j in range(start, end + 1):
        lines_to_remove.add(j)
    # Also remove imports that were only needed for this mock
    for j in range(max(0, start-3), start):
        if "sharedWorkbenchResources" in lines[j] or "chatviewResources" in lines[j]:
            lines_to_remove.add(j)
    lines = [l for i, l in enumerate(lines) if i not in lines_to_remove]
    # Also remove blank line after the removed block
    while len(lines) > 0 and lines[-1].strip() == '':
        lines.pop()

with open('app/shared/src/workbench/AgentHubWorkbench.test.tsx', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f"Removed lines {start}-{end} from test file")
