// SRP: single responsibility - migrate legacy allocation keys to hierarchical taxonomy
// OCP: add new migration rules without editing caller

export function migrateIdealAllocation(loadedAllocation: Record<string, number>): { migrated: Record<string, number>; needsSync: boolean } {
  const migrated = { ...loadedAllocation };
  let needsSync = false;

  if (migrated['Mutual Funds'] !== undefined) {
    const mfAlloc = migrated['Mutual Funds'];
    delete migrated['Mutual Funds'];
    migrated['Equities'] = (migrated['Equities'] || 0) + Math.round(mfAlloc * 0.7);
    migrated['Fixed Income'] = (migrated['Fixed Income'] || 0) + Math.round(mfAlloc * 0.3);
    needsSync = true;
  }
  if (migrated['Mutual Fund - Equity'] !== undefined) {
    migrated['Equities'] = (migrated['Equities'] || 0) + migrated['Mutual Fund - Equity'];
    delete migrated['Mutual Fund - Equity'];
    needsSync = true;
  }
  if (migrated['Mutual Fund - Debt'] !== undefined) {
    migrated['Fixed Income'] = (migrated['Fixed Income'] || 0) + migrated['Mutual Fund - Debt'];
    delete migrated['Mutual Fund - Debt'];
    needsSync = true;
  }
  if (migrated['Debt'] !== undefined) {
    migrated['Fixed Income'] = (migrated['Fixed Income'] || 0) + migrated['Debt'];
    delete migrated['Debt'];
    needsSync = true;
  }
  if (migrated['Debt and Fixed'] !== undefined) {
    migrated['Fixed Income'] = (migrated['Fixed Income'] || 0) + migrated['Debt and Fixed'];
    delete migrated['Debt and Fixed'];
    needsSync = true;
  }
  if (migrated['Domestic Equity'] !== undefined) {
    const val = migrated['Domestic Equity'];
    delete migrated['Domestic Equity'];
    migrated['Equities > Domestic Equity'] = val;
    needsSync = true;
  }
  if (migrated['Global Equity'] !== undefined) {
    const val = migrated['Global Equity'];
    delete migrated['Global Equity'];
    migrated['Equities > Global Equity'] = val;
    needsSync = true;
  }
  if (migrated['Gold'] !== undefined) {
    const val = migrated['Gold'];
    delete migrated['Gold'];
    migrated['Commodities > Gold'] = val;
    needsSync = true;
  }
  if (migrated['Silver'] !== undefined) {
    const val = migrated['Silver'];
    delete migrated['Silver'];
    migrated['Commodities > Silver'] = val;
    needsSync = true;
  }

  return { migrated, needsSync };
}
