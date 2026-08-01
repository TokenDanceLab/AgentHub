import { beforeEach, describe, expect, it } from 'vitest';
import { useSearchStore } from './searchStore';

describe('searchStore', () => {
  beforeEach(() => {
    useSearchStore.setState({ open: false, query: '', results: [], selectedIndex: 0 });
  });

  it('opens with and without an initial query, then resets its result selection', () => {
    useSearchStore.getState().openDialog();
    expect(useSearchStore.getState()).toMatchObject({ open: true, query: '', results: [], selectedIndex: 0 });
    useSearchStore.getState().setResults([{ id: 't1', type: 'thread', title: 'Thread', snippet: 'hello' }]);
    useSearchStore.getState().setSelectedIndex(1);
    useSearchStore.getState().openDialog('needle');
    expect(useSearchStore.getState()).toMatchObject({ open: true, query: 'needle', results: [], selectedIndex: 0 });
  });

  it('updates and closes the dialog through store commands', () => {
    useSearchStore.getState().openDialog('old');
    useSearchStore.getState().setQuery('new');
    expect(useSearchStore.getState().query).toBe('new');
    useSearchStore.getState().closeDialog();
    expect(useSearchStore.getState().open).toBe(false);
  });
});
