export function archiveUtcDate(value: Date | string): Date {
  // PostgreSQL timestamp columns in the archive JSON are UTC but omit the suffix.
  const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(value) ? `${value}Z` : value;
  return new Date(normalized);
}

// Manual purchases freeze the configured private cost at registration, even
// for backdated purchases. This exception must not be used for online orders.
export function configuredManualCost(
  cost: { unitCostCents: number | null } | null | undefined,
): number | null {
  if (cost?.unitCostCents == null || !Number.isSafeInteger(cost.unitCostCents) || cost.unitCostCents < 0) return null;
  return cost.unitCostCents;
}
