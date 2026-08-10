const SEARCH_SYNONYM_GROUPS = [
  ['azul', 'azules', 'blue'],
  ['negro', 'negros', 'negra', 'negras', 'black'],
  ['gris', 'grises', 'grey', 'gray'],
  ['blanco', 'blancos', 'blanca', 'blancas', 'white'],
  ['rojo', 'rojos', 'roja', 'rojas', 'red'],
  ['verde', 'verdes', 'green'],
  ['amarillo', 'amarillos', 'amarilla', 'amarillas', 'yellow'],
  ['rosa', 'rosas', 'pink'],
  ['morado', 'morados', 'morada', 'moradas', 'violeta', 'violetas', 'purple'],
  ['marron', 'marrones', 'brown'],
  ['burdeos', 'burgundy'],
  ['camiseta', 'camisetas', 'tee', 'tees', 'tshirt', 'tshirts'],
  ['sudadera', 'sudaderas', 'hoodie', 'hoodies', 'sweatshirt', 'sweatshirts'],
  ['chaqueta', 'chaquetas', 'jacket', 'jackets'],
  ['pantalon', 'pantalones', 'pants', 'trousers'],
  [
    'complemento',
    'complementos',
    'accesorio',
    'accesorios',
    'accessory',
    'accessories',
  ],
] as const;

const SEARCH_SYNONYMS = new Map<string, string[]>();
for (const group of SEARCH_SYNONYM_GROUPS) {
  for (const term of group) {
    SEARCH_SYNONYMS.set(term, [...group]);
  }
}

export const normalizeSearchText = (value: unknown): string =>
  String(
    typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
      ? value
      : '',
  )
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bt\s*-?\s*shirts?\b/g, 'tshirt')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

export const normalizeSearchKeywords = (values?: string[]): string[] => {
  if (!Array.isArray(values)) return [];

  const normalized = values
    .flatMap((value) => String(value ?? '').split(','))
    .map((value) => normalizeSearchText(value))
    .filter(Boolean);

  return [...new Set(normalized)].slice(0, 40);
};

export const buildProductSearchText = (product: {
  name?: unknown;
  slug?: unknown;
  description?: unknown;
  collection?: unknown;
  searchKeywords?: string[];
}): string =>
  normalizeSearchText(
    [
      product.name,
      product.slug,
      product.description,
      product.collection,
      ...(product.searchKeywords ?? []),
    ].join(' '),
  );

export const expandSearchTokens = (query: unknown): string[][] =>
  normalizeSearchText(query)
    .split(' ')
    .filter(Boolean)
    .slice(0, 12)
    .map((token) => SEARCH_SYNONYMS.get(token) ?? [token]);

const allTokenGroupsMatch = (values: unknown[], tokenGroups: string[][]) => {
  const fields = values
    .map((value) => normalizeSearchText(value))
    .filter(Boolean);
  return tokenGroups.every((terms) =>
    terms.some((term) => fields.some((field) => field.includes(term))),
  );
};

export interface SearchRankProduct {
  name?: unknown;
  slug?: unknown;
  description?: unknown;
  collection?: unknown;
  searchKeywords?: string[];
  categories?: Array<{
    [key: string]: unknown;
    category?: { name?: unknown; slug?: unknown } | null;
    name?: unknown;
    slug?: unknown;
  }>;
}

export const scoreProductSearch = (
  product: SearchRankProduct,
  query: unknown,
): number => {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedName = normalizeSearchText(product.name);
  const tokenGroups = expandSearchTokens(normalizedQuery);
  if (!normalizedQuery || !tokenGroups.length) return 0;

  let score = 0;
  if (normalizedName === normalizedQuery) score = 1000;
  else if (normalizedName.startsWith(normalizedQuery)) score = 800;
  else if (normalizedName.includes(normalizedQuery)) score = 600;
  else if (allTokenGroupsMatch([product.name], tokenGroups)) score = 550;

  const categoryValues = (product.categories ?? []).flatMap((assignment) => {
    const category = assignment.category ?? assignment;
    return [category.name, category.slug];
  });
  if (
    allTokenGroupsMatch(
      [
        product.slug,
        product.collection,
        ...(product.searchKeywords ?? []),
        ...categoryValues,
      ],
      tokenGroups,
    )
  ) {
    score = Math.max(score, 400);
  }

  if (allTokenGroupsMatch([product.description], tokenGroups)) {
    score = Math.max(score, 200);
  }

  return score;
};
