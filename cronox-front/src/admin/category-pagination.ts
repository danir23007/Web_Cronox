/** Collect the category endpoint's complete snapshot before exposing any options. */
export async function loadCategoryPages(
  load: (query: { page: number; limit: number; orderBy: string; order: string }) => Promise<unknown>,
) {
  const categories = new Map<number, Record<string, unknown>>();
  let total: number | undefined;
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const response = await load({ page, limit: 100, orderBy: 'name', order: 'asc' }) as {
      items: Record<string, unknown>[];
      meta: { page: number; limit: number; total: number; pageCount: number };
    };
    const meta = response?.meta;
    if (!Array.isArray(response?.items) || !meta || meta.page !== page || meta.limit !== 100 ||
        !Number.isSafeInteger(meta.total) || meta.total < 0 ||
        meta.pageCount !== Math.ceil(meta.total / 100) ||
        (total !== undefined && total !== meta.total) ||
        response.items.length !== Math.min(100, Math.max(0, meta.total - (page - 1) * 100))) {
      throw new Error('La lista de categorías ha cambiado o está incompleta. Reintenta la carga.');
    }
    total = meta.total;
    pages = meta.pageCount;
    for (const category of response.items) {
      const id = Number(category.id);
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('Categoría inválida. Reintenta la carga.');
      if (!categories.has(id)) categories.set(id, category);
    }
  }
  // Duplicate rows between pages can signal concurrent edits: never label a partial list complete.
  if (categories.size !== total) throw new Error('La lista de categorías está incompleta. Reintenta la carga.');
  return [...categories.values()];
}
