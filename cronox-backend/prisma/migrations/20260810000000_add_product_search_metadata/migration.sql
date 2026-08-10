CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "Product"
ADD COLUMN "searchKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';

UPDATE "Product"
SET "searchText" = trim(
  regexp_replace(
    translate(
      lower(
        concat_ws(
          ' ',
          "name",
          "slug",
          "description",
          "collection",
          array_to_string("searchKeywords", ' ')
        )
      ),
      'áéíóúüñ',
      'aeiouun'
    ),
    '\s+',
    ' ',
    'g'
  )
);

CREATE INDEX "Product_searchText_idx"
ON "Product" USING GIN ("searchText" gin_trgm_ops);
