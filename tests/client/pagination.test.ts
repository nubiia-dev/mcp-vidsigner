import { describe, expect, it } from 'vitest';
import { VidSignerClient, VidSignerError, normalizeDocumentPage } from '../../src/client/index.js';
import { json, mockFetch, noSleep } from '../helpers/mock-fetch.js';

const make = (fetchImpl: typeof fetch) =>
  new VidSignerClient({
    subscriptionName: 'S',
    subscriptionPass: 'P-1234',
    fetch: fetchImpl,
    sleep: noSleep,
  });

const item = (n: number) => ({
  FileName: `f${n}.pdf`,
  DocGUI: `guid-${n}`,
  DocStatus: 'Unsigned',
  Downloaded: false,
});
const items = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => item(from + i));

describe('listDocuments: parameters and validation', () => {
  it('sends paginationDTO.* with the exact OpenAPI names', async () => {
    const m = mockFetch(() => json(200, []));
    await make(m.fetch).listDocuments('unsigned', {
      pageNumber: 2,
      pageSize: 25,
      searchText: 'contract',
      orderBy: 'FileName',
      orderType: 'asc',
    });
    const url = new URL(m.calls[0]!.url);
    expect(url.pathname.endsWith('/documentlist/unsigned')).toBe(true);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'paginationDTO.pageNumber': '2',
      'paginationDTO.pageSize': '25',
      'paginationDTO.searchText': 'contract',
      'paginationDTO.orderBy': 'FileName',
      'paginationDTO.orderType': 'asc',
    });
  });

  it.each([
    ['asc', 'asc'],
    ['des', 'des'],
    ['desc', 'des'],
  ] as const)(
    'orderType %s is sent to the server as %s (the server rejects desc)',
    async (input, wire) => {
      const m = mockFetch(() => json(200, []));
      await make(m.fetch).listDocuments('all', { orderType: input });
      expect(new URL(m.calls[0]!.url).searchParams.get('paginationDTO.orderType')).toBe(wire);
    },
  );

  it('with any pagination parameter it fills in pageNumber=1 and pageSize=50 (the API requires them)', async () => {
    const m = mockFetch(() => json(200, []));
    await make(m.fetch).listDocuments('unsigned', { pageSize: 5 });
    await make(m.fetch).listDocuments('unsigned', { searchText: 'abc' });
    const q = (i: number) => Object.fromEntries(new URL(m.calls[i]!.url).searchParams);
    expect(q(0)).toMatchObject({ 'paginationDTO.pageNumber': '1', 'paginationDTO.pageSize': '5' });
    expect(q(1)).toMatchObject({ 'paginationDTO.pageNumber': '1', 'paginationDTO.pageSize': '50' });
  });

  it('without options it sends no query', async () => {
    const m = mockFetch(() => json(200, []));
    await make(m.fetch).listDocuments('all');
    expect(m.calls[0]?.url.endsWith('/documentlist/all')).toBe(true);
  });

  it.each([
    [{ pageNumber: 0 }, /pageNumber/],
    [{ pageNumber: -1 }, /pageNumber/],
    [{ pageNumber: 1.5 }, /pageNumber/],
    [{ pageSize: 0 }, /pageSize/],
    [{ pageSize: 100 }, /pageSize/],
    [{ pageSize: 200 }, /pageSize/],
  ])('rejects %j before calling the API', async (opts, msg) => {
    const m = mockFetch(() => json(200, []));
    const err = (await make(m.fetch)
      .listDocuments('all', opts)
      .catch((e: unknown) => e)) as VidSignerError;
    expect(err.kind).toBe('validation');
    expect(err.message).toMatch(msg);
    expect(m.calls).toHaveLength(0);
  });

  it('accepts the pageSize limits 1 and 99', async () => {
    const m = mockFetch(() => json(200, []));
    await make(m.fetch).listDocuments('all', { pageSize: 1 });
    await make(m.fetch).listDocuments('all', { pageSize: 99 });
    expect(m.calls).toHaveLength(2);
  });

  it('rejects an unknown filter', async () => {
    const m = mockFetch(() => json(200, []));
    // @ts-expect-error invalid filter on purpose
    await expect(make(m.fetch).listDocuments('everything')).rejects.toThrow(/Invalid filter/);
  });
});

describe('listDocuments: response shapes', () => {
  it('flat array (manual) -> no metadata', async () => {
    const page = await make(mockFetch(() => json(200, items(1, 3))).fetch).listDocuments('all');
    expect(page.items).toHaveLength(3);
    expect(page.unpaginated).toBe(true);
  });

  it('paginated object (OpenAPI) -> metadata', async () => {
    const body = {
      List: items(1, 2),
      PageNumber: 1,
      PageSize: 2,
      TotalPages: 3,
      HasNext: true,
      Count: 6,
    };
    const page = await make(mockFetch(() => json(200, body)).fetch).listDocuments('all', {
      pageSize: 2,
    });
    expect(page).toMatchObject({
      pageNumber: 1,
      pageSize: 2,
      totalPages: 3,
      hasNext: true,
      unpaginated: false,
    });
    expect(page.items).toHaveLength(2);
  });

  it('normalizeDocumentPage tolerates garbage', () => {
    expect(normalizeDocumentPage(null).items).toEqual([]);
    expect(normalizeDocumentPage({ foo: 1 }).items).toEqual([]);
    expect(normalizeDocumentPage('x').items).toEqual([]);
  });
});

describe('listAllDocuments', () => {
  function paged(total: number, pageSize: number) {
    const all = items(1, total);
    return mockFetch((call) => {
      const u = new URL(call.url);
      const n = Number(u.searchParams.get('paginationDTO.pageNumber') ?? '1');
      const size = Number(u.searchParams.get('paginationDTO.pageSize') ?? String(pageSize));
      const slice = all.slice((n - 1) * size, n * size);
      return slice.length === 0
        ? json(404, { Error: { Code: 50002, Message: 'The list of documents are empty' } })
        : json(200, {
            List: slice,
            PageNumber: n,
            PageSize: size,
            HasNext: n * size < total,
            TotalPages: Math.ceil(total / size),
          });
    });
  }

  it('walks all pages with HasNext', async () => {
    const m = paged(7, 3);
    const all = await make(m.fetch).listAllDocuments('all', { pageSize: 3 });
    expect(all.map((d) => d.DocGUI)).toEqual(items(1, 7).map((d) => d.DocGUI));
    expect(m.calls).toHaveLength(3);
  });

  it('a total that is a multiple of the page size ends with the 404/50002 of the empty page', async () => {
    // Without HasNext (flat array): a full page forces requesting the next one.
    const all = items(1, 4);
    const m = mockFetch((call) => {
      const n = Number(new URL(call.url).searchParams.get('paginationDTO.pageNumber'));
      const slice = all.slice((n - 1) * 2, n * 2);
      return slice.length
        ? json(200, slice)
        : json(404, { Error: { Code: 50002, Message: 'empty' } });
    });
    const res = await make(m.fetch).listAllDocuments('all', { pageSize: 2 });
    expect(res).toHaveLength(4);
    expect(m.calls).toHaveLength(3);
  });

  it('if the server ignores pagination and repeats the list, it does not loop', async () => {
    const m = mockFetch(() => json(200, items(1, 5)));
    const res = await make(m.fetch).listAllDocuments('all', { pageSize: 5 });
    expect(res).toHaveLength(5);
    expect(m.calls).toHaveLength(2);
  });

  it('honors maxPages', async () => {
    const m = paged(100, 2);
    const res = await make(m.fetch).listAllDocuments('all', { pageSize: 2, maxPages: 3 });
    expect(res).toHaveLength(6);
    expect(m.calls).toHaveLength(3);
  });

  it('empty list -> []', async () => {
    const m = mockFetch(() => json(404, { Error: { Code: 50002, Message: 'empty' } }));
    expect(await make(m.fetch).listAllDocuments('all')).toEqual([]);
  });
});
