/** @jest-environment node */

import type { AllocationNode, ExposureSlice } from '../analytics';
import {
  evaluateCompliance,
  evaluateRanges,
  evaluateSectorPolicy,
  rangeStatusFor,
  severityForRange,
} from '../compliance';
import { resolvePolicyConfig, type PolicyConfig } from '../policy';

function makeNode(fullPath: string, currentValue: number): AllocationNode {
  return {
    category: fullPath.split(' > ').pop() ?? fullPath,
    fullPath,
    currentValue,
    currentPercentage: 0,
    idealPercentage: 0,
    diffPercentage: 0,
    diffValue: 0,
    constituents: [],
    subCategories: [],
  };
}

function makeConfig(): PolicyConfig {
  const config = resolvePolicyConfig({
    settingsAllocation: {
      Equities: 60,
      'Fixed Income': 15,
      Commodities: 5,
      Crypto: 5,
      Cash: 15,
    },
  });
  config.decisionLevels['Equities > Domestic Equity'] = 'policy';
  config.effectiveTargets['Equities > Domestic Equity'] = 42;
  config.ranges['Equities > Domestic Equity'] = { min: 40, max: 46 };
  config.sectorTargets = { Financials: 50, Technology: 35, Energy: 15 };
  config.sectorRanges = {
    Financials: { min: 45, max: 60 },
    Technology: { min: 25, max: 45 },
    Energy: { min: 5, max: 20 },
  };
  return config;
}

const nodes = [
  makeNode('Equities', 620),
  makeNode('Fixed Income', 150),
  makeNode('Commodities', 40),
  makeNode('Crypto', 40),
  makeNode('Cash', 150),
  makeNode('Equities > Domestic Equity', 430),
  makeNode('Equities > Global Equity', 190),
];

const sectors: ExposureSlice[] = [
  { key: 'Financials', name: 'Financials', value: 320, direct: 320, indirect: 0, constituents: [] },
  { key: 'Technology', name: 'Technology', value: 240, direct: 240, indirect: 0, constituents: [] },
  { key: 'Energy', name: 'Energy', value: 100, direct: 100, indirect: 0, constituents: [] },
  {
    key: 'Other / Uncategorized',
    name: 'Other / Uncategorized',
    value: 60,
    direct: 60,
    indirect: 0,
    constituents: [],
  },
];

describe('range status', () => {
  it('classifies outside, edge and inside observations', () => {
    expect(rangeStatusFor(39, { min: 40, max: 46 })).toBe('below');
    expect(rangeStatusFor(40.5, { min: 40, max: 46 })).toBe('watch-low');
    expect(rangeStatusFor(43, { min: 40, max: 46 })).toBe('inside');
    expect(rangeStatusFor(45.7, { min: 40, max: 46 })).toBe('watch-high');
    expect(rangeStatusFor(47, { min: 40, max: 46 })).toBe('above');
  });

  it('maps range status to compliance severity', () => {
    expect(severityForRange('below')).toBe('breach');
    expect(severityForRange('watch-high')).toBe('watch');
    expect(severityForRange('inside')).toBe('ok');
  });
});

describe('range evaluation', () => {
  it('evaluates roots and promoted nodes with effective weights', () => {
    const rows = evaluateRanges({ config: makeConfig(), nodes, totalValue: 1000 });
    expect(rows).toHaveLength(6);
    const domestic = rows.find((row) => row.path === 'Equities > Domestic Equity');
    expect(domestic?.targetPercentage).toBe(42);
    expect(domestic?.currentPercentage).toBe(43);
    expect(domestic?.status).toBe('inside');
    expect(domestic?.level).toBe('policy');
  });

  it('keeps composition-only nodes out of the compliance report', () => {
    const config = makeConfig();
    delete config.decisionLevels['Equities > Domestic Equity'];
    const rows = evaluateRanges({ config, nodes, totalValue: 1000 });
    expect(rows.some((row) => row.path.includes('Domestic Equity'))).toBe(false);
  });
});

describe('sector policy', () => {
  it('compares sector weights with a separate policy', () => {
    const result = evaluateSectorPolicy({
      sectors,
      equityTotal: 600,
      targets: { Financials: 50, Technology: 40, Energy: 10 },
    });
    const financials = result.rows.find((row) => row.sector === 'Financials');
    expect(financials?.currentPercentage).toBeCloseTo(53.33, 1);
    expect(financials?.targetPercentage).toBe(50);
    expect(result.targetSum).toBe(100);
    expect(result.unallocatedPercentage).toBe(0);
  });

  it('shows an explicit sector remainder and untargeted exposure', () => {
    const result = evaluateSectorPolicy({
      sectors,
      equityTotal: 600,
      targets: { Financials: 50, Technology: 30 },
    });
    expect(result.targetSum).toBe(80);
    expect(result.unallocatedPercentage).toBe(20);
    const other = result.rows.find((row) => row.sector === 'Other / Uncategorized');
    expect(other?.status).toBe('untargeted');
  });
});

describe('compliance report', () => {
  it('passes when ranges, cash, concentration and coverage are healthy', () => {
    const report = evaluateCompliance({
      config: makeConfig(),
      nodes,
      totalValue: 1000,
      fundCoverage: { withData: 4, total: 4 },
      unmanagedPercentage: 0,
      holdings: [
        { name: 'HDFC Bank', symbol: 'HDFCBANK.NS', value: 80 },
        { name: 'Infosys', symbol: 'INFY.NS', value: 70 },
      ],
      sectors,
      equityTotal: 600,
      reviewDue: null,
      sectorConcentrationLimitPct: 60,
    });
    expect(report.status).toBe('compliant');
    expect(report.breachCount).toBe(0);
    expect(report.sectorPolicyDefined).toBe(true);
  });

  it('flags a cash floor breach and an off-policy portfolio', () => {
    const config = makeConfig();
    const cashNodes = nodes.map((node) =>
      node.fullPath === 'Cash' ? { ...node, currentValue: 20 } : node,
    );
    const report = evaluateCompliance({
      config,
      nodes: cashNodes,
      totalValue: 1000,
      fundCoverage: { withData: 1, total: 4 },
      unmanagedPercentage: 22,
      holdings: [{ name: 'Concentrated holding', symbol: 'X', value: 220 }],
      sectors,
      equityTotal: 600,
      reviewDue: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    });
    expect(report.status).toBe('breach');
    expect(report.checks.some((check) => check.id === 'cash-floor' && check.severity === 'breach')).toBe(true);
    expect(report.checks.some((check) => check.id === 'single-holding' && check.severity === 'breach')).toBe(true);
    expect(report.checks.some((check) => check.id === 'policy-review' && check.severity === 'breach')).toBe(true);
  });

  it('reports a sector policy that exceeds 100%', () => {
    const config = makeConfig();
    config.sectorTargets = { Financials: 60, Technology: 50 };
    const report = evaluateCompliance({
      config,
      nodes,
      totalValue: 1000,
      fundCoverage: { withData: 4, total: 4 },
      unmanagedPercentage: 0,
      holdings: [],
      sectors,
      equityTotal: 600,
      reviewDue: null,
    });
    expect(report.sectorTargetSum).toBe(110);
    expect(report.checks.some((check) => check.id === 'sector-policy-sum' && check.severity === 'breach')).toBe(true);
  });
});

describe('single-stock equity cap', () => {
  const base = {
    config: makeConfig(),
    nodes,
    totalValue: 1000,
    fundCoverage: { withData: 4, total: 4 },
    unmanagedPercentage: 0,
    sectors,
    equityTotal: 600,
    reviewDue: null,
    sectorConcentrationLimitPct: 60,
  };

  it('flags stocks above 10% of the equity sleeve, including fund look-through', () => {
    const report = evaluateCompliance({
      ...base,
      holdings: [
        { name: 'HDFC Bank', symbol: 'HDFCBANK.NS', value: 80 },
        { name: 'Infosys', symbol: 'INFY.NS', value: 70 },
      ],
      stockConcentration: {
        rows: [
          {
            name: 'HDFC Bank',
            totalValue: 8_000,
            fundValue: 2_000,
            equityPercentage: 13.33,
            status: 'breach',
          },
          {
            name: 'Infosys',
            totalValue: 70,
            fundValue: 0,
            equityPercentage: 11.67,
            status: 'breach',
          },
        ],
        equityValue: 600,
        limitPct: 10,
      },
    });

    const check = report.checks.find((item) => item.id === 'single-stock-equity');
    expect(check?.severity).toBe('breach');
    expect(check?.label).toBe('Single-stock concentration (equity)');
    expect(check?.detail).toContain('2 stocks exceed the 10% equity cap');
    expect(check?.detail).toContain('including ₹20 via funds');
    expect(check?.value).toBeCloseTo(13.33, 2);
    expect(check?.limit).toBe(10);
    expect(report.status).toBe('breach');

    const portfolioCheck = report.checks.find((item) => item.id === 'single-holding');
    expect(portfolioCheck?.label).toBe('Single-holding concentration (portfolio)');
  });

  it('watches a stock just below the cap', () => {
    const report = evaluateCompliance({
      ...base,
      holdings: [],
      stockConcentration: {
        rows: [
          {
            name: 'HDFC Bank',
            totalValue: 57,
            fundValue: 0,
            equityPercentage: 9.5,
            status: 'watch',
          },
        ],
        equityValue: 600,
        limitPct: 10,
      },
    });

    const check = report.checks.find((item) => item.id === 'single-stock-equity');
    expect(check?.severity).toBe('watch');
    expect(check?.detail).toContain('close to the 10% cap');
    expect(report.status).toBe('watch');
  });

  it('passes when every stock is inside the cap', () => {
    const report = evaluateCompliance({
      ...base,
      holdings: [],
      stockConcentration: {
        rows: [
          {
            name: 'HDFC Bank',
            totalValue: 30,
            fundValue: 0,
            equityPercentage: 5,
            status: 'ok',
          },
        ],
        equityValue: 600,
        limitPct: 10,
      },
    });

    const check = report.checks.find((item) => item.id === 'single-stock-equity');
    expect(check?.severity).toBe('ok');
    expect(check?.detail).toContain('Largest stock, HDFC Bank');
    expect(report.status).toBe('compliant');
  });
});
