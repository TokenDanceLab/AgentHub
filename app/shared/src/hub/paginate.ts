import type { HubPageInfo } from './hubClientDomainTypes';

// The Hub's cursor-paged list contract, in one place (#2290).
//
// Every generic Hub list endpoint accepts `pageSize` + `pageCursor` and answers
// with `page.nextCursor` / `page.hasMore`. The server clamps pageSize to the
// ceiling the endpoint declares (config.MaxListPageSize = 200 for the generic
// cursor-paged lists, 100 for the payload-size-sensitive message family, 500
// for the run/team-event and document lists) and `ClampPageSize` never errors
// on an over-large request — it shortens the page. So a client that asks once
// and drops `nextCursor` does not get an error: it silently gets the first page
// and nothing tells it the list was cut.
//
// That is what the live paths used to do. `listWorkspaceProjects` was called
// with a fixed pageSize and no cursor in web and with no parameters at all in
// desktop; `listAgentProfiles` the same way; so from item 51 onwards the
// workspace/agent lists were short with no "load more", no truncation hint and
// no error. Each shell then hand-rolled its own cursor loop for execution
// targets, and this file exists so the next list does not become the fourth
// copy of that loop.
//
// Contract, deliberately identical for every caller:
//   - walk pages until the server says stop (`hasMore` false, or no
//     `nextCursor` to continue with);
//   - stop at `maxPages` and, when the cap is what stopped us, return
//     `hasMore: true` so a truncated list stays distinguishable from a
//     complete one. The cap is a stated ceiling, never a silent one;
//   - never invent a cursor: only a server-provided `nextCursor` continues the
//     walk.

/** Page size for the generic cursor-paged Hub lists = `config.MaxListPageSize`. */
export const HUB_LIST_PAGE_SIZE = 200;

/**
 * Page-walk ceiling for the generic lists: 5 x 200 = 1000 items. Past that the
 * caller sees `hasMore: true` and can say so in the UI. Endpoints whose own
 * ceiling is lower (messages: 100) or whose collections are genuinely larger
 * should pass explicit values rather than inherit these.
 */
export const HUB_LIST_MAX_PAGES = 5;

/** One page-returning list call, shaped like every `list*` method on HubClient. */
export type PagedFetch<TItem> = (params: {
  pageSize: number;
  pageCursor?: string;
}) => Promise<{ items: TItem[]; page?: HubPageInfo }>;

export interface FetchAllPagesOptions {
  /** Defaults to {@link HUB_LIST_PAGE_SIZE}. */
  pageSize?: number;
  /** Defaults to {@link HUB_LIST_MAX_PAGES}. */
  maxPages?: number;
}

export interface PagedResult<TItem> {
  items: TItem[];
  page: HubPageInfo;
}

/**
 * Walk every page of a cursor-paged Hub list, up to a stated cap.
 *
 * Errors are not caught: a failed page is a failed request, and the caller's
 * react-query wrapper already owns retry / error surface. Swallowing here would
 * turn a 401 into a short list, which is the exact failure mode this contract
 * exists to remove.
 */
export async function fetchAllPages<TItem>(
  fetchPage: PagedFetch<TItem>,
  options: FetchAllPagesOptions = {},
): Promise<PagedResult<TItem>> {
  const pageSize = options.pageSize ?? HUB_LIST_PAGE_SIZE;
  const maxPages = Math.max(1, Math.trunc(options.maxPages ?? HUB_LIST_MAX_PAGES));

  const items: TItem[] = [];
  let page: HubPageInfo = { hasMore: false };
  let pageCursor: string | undefined;

  for (let i = 0; i < maxPages; i += 1) {
    const res = await fetchPage({
      pageSize,
      ...(pageCursor ? { pageCursor } : {}),
    });
    items.push(...(res.items ?? []));
    page = res.page ?? { hasMore: false };
    if (!page.hasMore || !page.nextCursor) {
      return { items, page };
    }
    pageCursor = page.nextCursor;
  }

  // The cap stopped the walk, not the server: report hasMore so the caller can
  // surface truncation instead of presenting a short list as a complete one.
  return { items, page: { ...page, hasMore: true } };
}
