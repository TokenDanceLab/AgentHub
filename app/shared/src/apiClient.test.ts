import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getArtifactContent, setBaseUrl } from './apiClient';

const fetchMock = vi.fn<typeof fetch>();

describe('apiClient binary responses', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setBaseUrl('http://127.0.0.1:3210');
  });

  it('reads artifact content as Blob without JSON parsing', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('hello', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    const result = await getArtifactContent('artifact-1');

    expect(result).toBeInstanceOf(Blob);
    expect(await result.text()).toBe('hello');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:3210/v1/artifacts/artifact-1/content',
    );
  });
});
