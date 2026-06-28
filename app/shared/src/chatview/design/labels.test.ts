import { describe, expect, it } from 'vitest';
import type { RowItem } from '../types';
import { cardLabelKey } from './labels';

describe('cardLabelKey', () => {
  it('uses generic fallback labels for unknown running tools instead of exposing i18n keys', () => {
    const item: RowItem = {
      id: 'tool-bash',
      type: 'tool',
      label: 'bash',
      toolName: 'bash',
      status: 'running',
      collapsible: true,
    };

    expect(cardLabelKey(item)).toEqual({
      key: 'card.tool.generic.running',
      params: { name: 'bash' },
    });
  });
});
