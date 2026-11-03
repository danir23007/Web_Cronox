// Permanent public alias for the existing product (verified public ID 4).
// SKUs and order/checkout snapshots deliberately keep their historical values.
export const ARMORED_COAL = {
  id: 4,
  oldSlug: 'shielded-coal',
  slug: 'armored-coal',
} as const;

export const currentProductSlug = (slug: string): string =>
  slug === ARMORED_COAL.oldSlug ? ARMORED_COAL.slug : slug;
