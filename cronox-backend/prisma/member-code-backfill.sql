-- Crea la secuencia (idempotente)
CREATE SEQUENCE IF NOT EXISTS public.user_member_code_seq
    INCREMENT BY 1
    MINVALUE 1
    START WITH 1
    OWNED BY NONE;

-- Índice único (idempotente)
CREATE UNIQUE INDEX IF NOT EXISTS "User_memberCode_key" ON public."User" ("memberCode");

-- Backfill de memberCode siguiendo el orden de creación (createdAt, id)
WITH ordered_users AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS seq_num
  FROM public."User"
),
updated AS (
  UPDATE public."User" u
  SET "memberCode" = CONCAT(
    'CRX',
    CASE
      WHEN FLOOR((o.seq_num - 1)::numeric / 999999) = 0 THEN ''
      ELSE FLOOR((o.seq_num - 1)::numeric / 999999)::text
    END,
    '-',
    LPAD((((o.seq_num - 1) % 999999) + 1)::text, 6, '0')
  )
  FROM ordered_users o
  WHERE u.id = o.id
    AND u."memberCode" IS NULL
  RETURNING o.seq_num
),
max_seq AS (
  SELECT MAX(seq_num) AS max_seq_num FROM ordered_users
)
SELECT setval(
  'public.user_member_code_seq',
  GREATEST(
    COALESCE((SELECT max_seq_num FROM max_seq), 0),
    COALESCE((SELECT last_value FROM public.user_member_code_seq), 0)
  ),
  true
);
