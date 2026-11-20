import type { AllocationNode } from './analytics';
import type { Holding } from './aggregate';
import { normalizeCategory } from './normalize';

/**
 * Current unrealised contribution analysis. The app does not yet store
 * historical snapshots, so this is deliberately labelled as contribution, not
 * Brinson attribution. It never invents benchmark returns.
 */
export interface ContributionRow {
  key: string;
  label: string;
  currentValue: number;
  investedValue: number;
  pnl: number;
  pnlPercent: number;
  contributionPct: number;
  account: string;
}

export interface ContributionReport {
  bySleeve: ContributionRow[];
  byHolding: ContributionRow[];
  totalPnl: number;
  totalValue: number;
  totalInvested: number;
  winners: number;
  losers: number;
}

interface AllocationShare {
  path: string;
  value: number;
}

function collectShares(
  nodes: AllocationNode[],
  map: Map<string, AllocationShare[]> = new Map(),
): Map<string, AllocationShare[]> {
  for (const node of nodes) {
    for (const constituent of node.constituents ?? []) {
      const symbol = constituent.symbol;
      const shares = map.get(symbol) ?? [];
      shares.push({ path: node.fullPath, value: constituent.value });
      map.set(symbol, shares);
    }
    collectShares(node.subCategories ?? [], map);
  }
  return map;
}

function rootOf(path: string): string {
  return normalizeCategory(path.split(' > ')[0] ?? path);
}

function accountFor(holding: Holding): string {
  return holding.asset.account?.trim() || 'Primary';
}

function makeRow(
  key: string,
  label: string,
  currentValue: number,
  investedValue: number,
  totalValue: number,
  account: string,
): ContributionRow {
  const pnl = currentValue - investedValue;
  return {
    key,
    label,
    currentValue,
    investedValue,
    pnl,
    pnlPercent: investedValue > 0 ? (pnl / investedValue) * 100 : 0,
    contributionPct: totalValue > 0 ? (pnl / totalValue) * 100 : 0,
    account,
  };
}

export function buildContributionReport(input: {
  holdings: Holding[];
  nodes: AllocationNode[];
}): ContributionReport {
  const { holdings, nodes } = input;
  const shares = collectShares(nodes);
  const totalValue = holdings.reduce((sum, holding) => sum + holding.currentValue, 0);
  const totalInvested = holdings.reduce(
    (sum, holding) => sum + holding.investedValue,
    0,
  );

  const sleeveMap = new Map<string, { value: number; invested: number }>();
  const holdingRows: ContributionRow[] = [];

  for (const holding of holdings) {
    const symbolShares = (shares.get(holding.asset.symbol) ?? []).filter(
      (share) => share.value > 0,
    );
    const assignedTotal = symbolShares.reduce((sum, share) => sum + share.value, 0);

    if (symbolShares.length === 0 || assignedTotal <= 0) {
      const root = rootOf(normalizeCategory(holding.asset.type));
      const bucket = sleeveMap.get(root) ?? { value: 0, invested: 0 };
      bucket.value += holding.currentValue;
      bucket.invested += holding.investedValue;
      sleeveMap.set(root, bucket);
    } else {
      for (const share of symbolShares) {
        const ratio = share.value / assignedTotal;
        const root = rootOf(share.path);
        const bucket = sleeveMap.get(root) ?? { value: 0, invested: 0 };
        bucket.value += holding.currentValue * ratio;
        bucket.invested += holding.investedValue * ratio;
        sleeveMap.set(root, bucket);
      }
    }

    holdingRows.push(
      makeRow(
        holding.asset.id,
        holding.asset.name,
        holding.currentValue,
        holding.investedValue,
        totalValue,
        accountFor(holding),
      ),
    );
  }

  const bySleeve = [...sleeveMap.entries()]
    .map(([label, bucket]) =>
      makeRow(label, label, bucket.value, bucket.invested, totalValue, 'Household'),
    )
    .sort((a, b) => b.currentValue - a.currentValue);

  const byHolding = holdingRows.sort(
    (a, b) => Math.abs(b.pnl) - Math.abs(a.pnl),
  );

  return {
    bySleeve,
    byHolding,
    totalPnl: totalValue - totalInvested,
    totalValue,
    totalInvested,
    winners: holdingRows.filter((row) => row.pnl > 0).length,
    losers: holdingRows.filter((row) => row.pnl < 0).length,
  };
}

export interface AccountRow {
  account: string;
  currentValue: number;
  percentage: number;
  holdings: number;
  pnl: number;
}

export function accountSummary(holdings: Holding[]): AccountRow[] {
  const total = holdings.reduce((sum, holding) => sum + holding.currentValue, 0);
  const map = new Map<string, { value: number; count: number; pnl: number }>();
  for (const holding of holdings) {
    const account = accountFor(holding);
    const bucket = map.get(account) ?? { value: 0, count: 0, pnl: 0 };
    bucket.value += holding.currentValue;
    bucket.count += 1;
    bucket.pnl += holding.pnl;
    map.set(account, bucket);
  }
  return [...map.entries()]
    .map(([account, bucket]) => ({
      account,
      currentValue: bucket.value,
      percentage: total > 0 ? (bucket.value / total) * 100 : 0,
      holdings: bucket.count,
      pnl: bucket.pnl,
    }))
    .sort((a, b) => b.currentValue - a.currentValue);
}
