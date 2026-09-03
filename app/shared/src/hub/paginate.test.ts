import { describe, expect, it, vi } from 'vitest';
import {
  HUB_LIST_MAX_PAGES,
  HUB_LIST_PAGE_SIZE,
  fetchAllPages,
  type PagedFetch,
} from './paginate';

interface Item {
  id: string;
}

function page(ids: string[], next?: { hasMore: boolean; nextCursor?: string }) {
  return { items: ids.map((id) => ({ id })), page: next ?? { hasMore: false } };
}

describe('fetchAllPages', () => {
  it('returns a single page untouched when the server reports no more', async () => {
    const fetchPage = vi.fn<PagedFetch<Item>>().mockResolvedValue(page(['a', 'b']));

    const res = await fetchAllPages(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith({ pageSize: HUB_LIST_PAGE_SIZE });
    expect(res.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(res.page.hasMore).toBe(false);
  });

  it('walks cursors until the server stops, passing each nextCursor back', async () => {
    const fetchPage = vi.fn<PagedFetch<Item>>()
      .mockResolvedValueOnce(page(['a'], { hasMore: true, nextCursor: 'cur-1' }))
      .mockResolvedValueOnce(page(['b'], { hasMore: true, nextCursor: 'cur-2' }))
      .mockResolvedValueOnce(page(['c']));

    const res = await fetchAllPages(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage.mock.calls[1]?.[0]).toEqual({ pageSize: HUB_LIST_PAGE_SIZE, pageCursor: 'cur-1' });
    expect(fetchPage.mock.calls[2]?.[0]).toEqual({ pageSize: HUB_LIST_PAGE_SIZE, pageCursor: 'cur-2' });
    expect(res.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(res.page.hasMore).toBe(false);
  });

  it('stops when hasMore is true but no cursor was supplied (never invents one)', async () => {
    const fetchPage = vi.fn<PagedFetch<Item>>()
      .mockResolvedValue(page(['a'], { hasMore: true }));

    const res = await fetchAllPages(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(res.items).toHaveLength(1);
  });

  it('reports hasMore=true when the page cap is what stopped the walk', async () => {
    const fetchPage = vi.fn<PagedFetch<Item>>()
      .mockResolvedValue(page(['a'], { hasMore: true, nextCursor: 'cur-next' }));

    const res = await fetchAllPages(fetchPage, { maxPages: 3 });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(res.items).toHaveLength(3);
    // The cap must stay visible: a truncated list has to be distinguishable
    // from a complete one.
    expect(res.page.hasMore).toBe(true);
  });

  it('defaults to the canonical Hub list contract', async () => {
    const fetchPage = vi.fn<PagedFetch<Item>>()
      .mockResolvedValue(page(['a'], { hasMore: true, nextCursor: 'c' }));

    await fetchAllPages(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(HUB_LIST_MAX_PAGES);
    expect(fetchPage).toHaveBeenNthCalledWith(1, { pageSize: HUB_LIST_PAGE_SIZE });
    expect(HUB_LIST_PAGE_SIZE).toBe(200);
    expect(HUB_LIST_MAX_PAGES).toBe(5);
  });

  it('honours an explicit smaller ceiling (endpoints that cap below 200)', async () => {
    const fetchPage = vi.fn<PagedFetch<Item>>().mockResolvedValue(page(['a']));

    await fetchAllPages(fetchPage, { pageSize: 100, maxPages: 2 });

    expect(fetchPage).toHaveBeenCalledWith({ pageSize: 100 });
  });

  it('survives a missing items array or page object', async () => {
    const fetchPage = vi.fn<PagedFetch<Item>>().mockResolvedValue(
      {} as unknown as { items: Item[]; page?: { hasMore: boolean } },
    );

    const res = await fetchAllPages(fetchPage);

    expect(res.items).toEqual([]);
    expect(res.page.hasMore).toBe(false);
  });

  it('propagates a page error instead of returning a short list', async () => {
    const failure = new Error('401 unauthorized');
    const fetchPage = vi.fn<PagedFetch<Item>>()
      .mockResolvedValueOnce(page(['a'], { hasMore: true, nextCursor: 'cur-1' }))
      .mockRejectedValueOnce(failure);

    // A swallowed error here would look exactly like "the list has 1 item",
    // which is the failure mode this contract exists to remove.
    await expect(fetchAllPages(fetchPage)).rejects.toBe(failure);
  });

  it('treats a non-positive maxPages as one page rather than looping forever', async () => {
    const fetchPage = vi.fn<PagedFetch<Item>>()
      .mockResolvedValue(page(['a'], { hasMore: true, nextCursor: 'c' }));

    const res = await fetchAllPages(fetchPage, { maxPages: 0 });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(res.page.hasMore).toBe(true);
  });
});
