import { loadCategoryPages } from '../../../cronox-front/src/admin/category-pagination';

const category = (id: number) => ({ id, name: `Categoría ${String(id).padStart(3, '0')}` });
function source(total: number) {
  return jest.fn(async ({ page, limit }) => ({
    items: Array.from({ length: Math.min(limit, Math.max(0, total - (page - 1) * limit)) },
      (_, i) => category((page - 1) * limit + i + 1)),
    meta: { page, limit, total, pageCount: Math.ceil(total / limit) },
  }));
}
describe('complete category pagination', () => {
  it.each([0, 100, 101, 250])('loads all %i categories in endpoint order', async total => {
    const loader = source(total);
    const items = await loadCategoryPages(loader);
    expect(items.map(c => c.id)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(new Set(items.map(c => c.id)).size).toBe(total);
    expect(loader).toHaveBeenCalledTimes(Math.max(1, Math.ceil(total / 100)));
    for (const [query] of loader.mock.calls) expect(query).toMatchObject({ limit: 100, orderBy: 'name', order: 'asc' });
  });
  it('rejects a later error without exposing a partial result, then retries from page 1', async () => {
    const real = source(201);
    let fail = true;
    const loader = jest.fn(async query => {
      if (fail && query.page === 2) throw new Error('Network failure');
      return real(query);
    });
    await expect(loadCategoryPages(loader)).rejects.toThrow('Network failure');
    fail = false;
    expect(await loadCategoryPages(loader)).toHaveLength(201);
    expect(loader.mock.calls.map(([q]) => q.page)).toEqual([1, 2, 1, 2, 3]);
  });
  it('does not silently complete a response with duplicates and missing IDs', async () => {
    const real = source(101);
    await expect(loadCategoryPages(async query => {
      const result = await real(query);
      if (query.page === 2) result.items = [category(1)];
      return result;
    })).rejects.toThrow('incompleta');
  });
  it('rejects a changed total or a malformed response', async () => {
    await expect(loadCategoryPages(async () => ({ items: [] }))).rejects.toThrow();
    const real = source(101);
    await expect(loadCategoryPages(async query => {
      const result = await real(query);
      if (query.page === 2) result.meta.total = 102;
      return result;
    })).rejects.toThrow();
  });
});
