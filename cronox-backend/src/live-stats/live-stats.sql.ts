// A single statement provides one MVCC snapshot and one database clock.
export const LIVE_STATS_SQL = `
WITH active AS (
  SELECT p.*, c.id AS "cartId"
  FROM "LivePresence" p
  LEFT JOIN "User" u ON u.id=p."userId"
  LEFT JOIN "AuthSession" s ON s.id=p."sessionId" AND s."userId"=u.id
  LEFT JOIN "Cart" c ON (p."userId" IS NOT NULL AND c."userId"=p."userId")
    OR (p."userId" IS NULL AND c."userId" IS NULL AND c."anonymousId"=p."anonymousId")
  WHERE p."seenAt" > CURRENT_TIMESTAMP - INTERVAL '2 minutes'
    AND (p."userId" IS NULL OR (u.role NOT IN ('ADMIN','SUPERADMIN') AND u."accountState"='ACTIVE'
      AND s."revokedAt" IS NULL AND s.id IS NOT NULL AND s."sessionVersion"=u."sessionVersion"
      AND to_timestamp(s."refreshIssuedAt") + INTERVAL '500 days' > CURRENT_TIMESTAMP))
), carts AS (
  SELECT DISTINCT "cartId" FROM active WHERE "cartId" IS NOT NULL
), lines AS (
  SELECT i.*, v."productId" FROM carts c JOIN "CartItem" i ON i."cartId"=c."cartId"
    JOIN "ProductVariant" v ON v.id=i."variantId" WHERE i.qty>0
), locations AS (
  SELECT section, COUNT(*)::int AS visitors FROM active GROUP BY section
), products AS (
  SELECT p.id, p.name, COUNT(*)::int AS visitors FROM active a JOIN "Product" p ON p.id=a."productId"
  WHERE a.section='product' AND p."isActive" GROUP BY p.id,p.name ORDER BY visitors DESC,p.id LIMIT 5
), checkouts AS (
  SELECT DISTINCT a."cartId" FROM active a
  LEFT JOIN LATERAL (SELECT s.* FROM "CheckoutSnapshot" s WHERE s."cartId"=a."cartId" ORDER BY s."createdAt" DESC,s.id DESC LIMIT 1) s ON true
  WHERE a.section='checkout' AND EXISTS (SELECT 1 FROM lines l WHERE l."cartId"=a."cartId")
  AND (s.id IS NULL OR (s."orderId" IS NULL AND s.status IN ('RESERVED','PAYMENT_INTENT_CREATING','PAYMENT_BOUND') AND s."expiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')))
)
SELECT json_build_object(
  'at', CURRENT_TIMESTAMP,
  'visitors', json_build_object('total',(SELECT COUNT(*)::int FROM active),
    'signedIn',(SELECT COUNT(*)::int FROM active WHERE "userId" IS NOT NULL),
    'guests',(SELECT COUNT(*)::int FROM active WHERE "userId" IS NULL)),
  'carts', json_build_object('visitors',(SELECT COUNT(*)::int FROM active a WHERE EXISTS(SELECT 1 FROM lines l WHERE l."cartId"=a."cartId")),
    'units',(SELECT COALESCE(SUM(qty),0)::int FROM lines), 'products',(SELECT COUNT(DISTINCT "productId")::int FROM lines)),
  'checkouts',(SELECT COUNT(*)::int FROM checkouts),
  'payments',(SELECT COUNT(*)::int FROM "CheckoutSnapshot" WHERE "paymentStatus" IN ('processing','requires_action')
    AND "paymentLiveMode"=true AND "orderId" IS NULL AND status='PAYMENT_BOUND'
    AND ("paymentStatus"='processing' OR "expiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))),
  'purchases',(SELECT COUNT(*)::int FROM "Order" o JOIN "CheckoutSnapshot" s ON s."orderId"=o.id
    WHERE o."paidAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '30 minutes' AND o."paidAt"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AND s."paymentLiveMode"=true),
  'locations',COALESCE((SELECT json_agg(locations) FROM locations),'[]'::json),
  'products',COALESCE((SELECT json_agg(products) FROM products),'[]'::json)
) AS snapshot`;
