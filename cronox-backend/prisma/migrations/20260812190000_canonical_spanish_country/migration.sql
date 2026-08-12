-- CRONOX stores human-readable country names internally. This data-only
-- migration updates only address country fields containing known Spain aliases.
UPDATE "Address"
SET "country" = 'España'
WHERE lower(btrim("country")) IN ('es', 'spain', 'españa', 'espana');

UPDATE "CheckoutSnapshot"
SET "shippingAddr" = jsonb_set("shippingAddr", '{country}', to_jsonb('España'::text), false)
WHERE jsonb_typeof("shippingAddr") = 'object'
  AND lower(btrim("shippingAddr"->>'country')) IN ('es', 'spain', 'españa', 'espana');

UPDATE "CheckoutSnapshot"
SET "billingAddr" = jsonb_set("billingAddr", '{country}', to_jsonb('España'::text), false)
WHERE jsonb_typeof("billingAddr") = 'object'
  AND lower(btrim("billingAddr"->>'country')) IN ('es', 'spain', 'españa', 'espana');

UPDATE "Order"
SET "shippingAddr" = jsonb_set("shippingAddr", '{country}', to_jsonb('España'::text), false)
WHERE jsonb_typeof("shippingAddr") = 'object'
  AND lower(btrim("shippingAddr"->>'country')) IN ('es', 'spain', 'españa', 'espana');

UPDATE "Order"
SET "billingAddr" = jsonb_set("billingAddr", '{country}', to_jsonb('España'::text), false)
WHERE jsonb_typeof("billingAddr") = 'object'
  AND lower(btrim("billingAddr"->>'country')) IN ('es', 'spain', 'españa', 'espana');
