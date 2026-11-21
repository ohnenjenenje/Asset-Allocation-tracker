import {
  applyAssetProposal,
  buildAssetProposal,
  mergeAssetProposals,
  type AssetUpdateProposal,
} from '../tools';
import type { Asset } from '../../portfolio/types';

const asset = (overrides: Partial<Asset> & Pick<Asset, 'id' | 'symbol' | 'name'>): Asset => ({
  quantity: 10,
  entryPrice: 100,
  currency: 'INR',
  type: 'STOCK',
  ...overrides,
});

const assets: Asset[] = [
  asset({ id: 'a1', symbol: 'HDFCBANK.NS', name: 'HDFC Bank' }),
  asset({
    id: 'a2',
    symbol: 'MF_140084',
    name: 'Nifty 50 Index Fund',
    type: 'MUTUALFUND',
    quantity: 125.5,
    entryPrice: 42.125,
  }),
  asset({
    id: 'a3',
    symbol: 'BTC-USD',
    name: 'Bitcoin',
    type: 'CRYPTO',
    quantity: 0.05,
    entryPrice: 50000,
    currency: 'USD',
  }),
];

describe('buildAssetProposal', () => {
  it('matches a bare screenshot ticker to an exchange-qualified symbol', () => {
    const result = buildAssetProposal(
      {
        summary: 'Holdings screenshot',
        updates: [{ symbol: 'HDFCBANK', quantity: 12, entryPrice: 1500 }],
      },
      assets,
    );

    expect('proposal' in result).toBe(true);
    if (!('proposal' in result)) return;

    expect(result.proposal.updates).toHaveLength(1);
    expect(result.proposal.updates[0]).toMatchObject({
      assetId: 'a1',
      symbol: 'HDFCBANK.NS',
      currency: 'INR',
      changes: [
        { field: 'quantity', from: 10, to: 12 },
        { field: 'entryPrice', from: 100, to: 1500 },
      ],
    });
  });

  it('matches by exact name and keeps only fields that actually change', () => {
    const result = buildAssetProposal(
      {
        summary: 'Screenshot',
        updates: [
          {
            symbol: 'NIFTY50',
            name: 'Nifty 50 Index Fund',
            quantity: 125.5,
            entryPrice: 44,
          },
        ],
      },
      assets,
    );

    expect('proposal' in result).toBe(true);
    if (!('proposal' in result)) return;

    expect(result.proposal.updates[0].assetId).toBe('a2');
    expect(result.proposal.updates[0].changes).toEqual([
      { field: 'entryPrice', from: 42.125, to: 44 },
    ]);
  });

  it('accepts a USD holding and rejects unknown rows', () => {
    const result = buildAssetProposal(
      {
        summary: 'Crypto screenshot',
        updates: [
          { symbol: 'BTC-USD', quantity: 0.08 },
          { symbol: 'NOT-A-HOLDING', quantity: 3 },
        ],
      },
      assets,
    );

    expect('proposal' in result).toBe(true);
    if (!('proposal' in result)) return;

    expect(result.proposal.updates).toHaveLength(1);
    expect(result.proposal.updates[0]).toMatchObject({
      assetId: 'a3',
      currency: 'USD',
      changes: [{ field: 'quantity', from: 0.05, to: 0.08 }],
    });
  });

  it('matches a generic detail-screen title to the silver holding', () => {
    const withSilver = [
      ...assets,
      asset({
        id: 'a4',
        symbol: 'SILVER-INR-GRAM',
        name: 'Physical Silver (Per Gram)',
        type: 'COMMODITY',
        quantity: 0.0613,
        entryPrice: 158.4,
      }),
    ];

    const result = buildAssetProposal(
      {
        summary: 'Silver Vault',
        updates: [{ name: 'Silver Vault', quantity: 6.2885 }],
      },
      withSilver,
    );

    expect('proposal' in result).toBe(true);
    if (!('proposal' in result)) return;

    expect(result.proposal.updates).toHaveLength(1);
    expect(result.proposal.updates[0]).toMatchObject({
      assetId: 'a4',
      symbol: 'SILVER-INR-GRAM',
      changes: [{ field: 'quantity', from: 0.0613, to: 6.2885 }],
    });
  });

  it('does not match a different silver product by one shared word', () => {
    const withSilver = [
      ...assets,
      asset({
        id: 'a4',
        symbol: 'SILVER-INR-GRAM',
        name: 'Physical Silver (Per Gram)',
        type: 'COMMODITY',
        quantity: 0.0613,
        entryPrice: 158.4,
      }),
    ];

    const result = buildAssetProposal(
      {
        summary: 'Silver ETF',
        updates: [{ name: 'Silver ETF', quantity: 10 }],
      },
      withSilver,
    );

    expect('error' in result).toBe(true);
  });

  it('does not turn cash or savings labels into a holding', () => {
    const withSilver = [
      ...assets,
      asset({
        id: 'a4',
        symbol: 'SILVER-INR-GRAM',
        name: 'Physical Silver (Per Gram)',
        type: 'COMMODITY',
        quantity: 0.0613,
        entryPrice: 158.4,
      }),
    ];

    const result = buildAssetProposal(
      {
        summary: 'Silver Vault',
        updates: [
          { name: 'Active Savings', quantity: 1001.53 },
          { name: 'Silver Value', entryPrice: 157.92 },
        ],
      },
      withSilver,
    );

    expect('error' in result).toBe(true);
  });

  it('returns an error when nothing matches or nothing changes', () => {
    const noMatch = buildAssetProposal(
      { summary: 'x', updates: [{ symbol: 'UNKNOWN', quantity: 1 }] },
      assets,
    );
    expect('error' in noMatch).toBe(true);

    const noChange = buildAssetProposal(
      { summary: 'x', updates: [{ symbol: 'HDFCBANK.NS', quantity: 10 }] },
      assets,
    );
    expect('error' in noChange).toBe(true);
  });

  it('records a manual price separately and de-duplicates repeated rows', () => {
    const result = buildAssetProposal(
      {
        summary: 'Price screenshot',
        updates: [
          { symbol: 'HDFCBANK.NS', quantity: 11 },
          { symbol: 'HDFCBANK.NS', quantity: 12, manualPrice: 1650 },
        ],
      },
      assets,
    );

    expect('proposal' in result).toBe(true);
    if (!('proposal' in result)) return;

    expect(result.proposal.updates).toHaveLength(1);
    expect(result.proposal.updates[0].changes).toEqual([
      { field: 'quantity', from: 10, to: 12 },
      { field: 'manualPrice', from: null, to: 1650 },
    ]);
  });
});

describe('applyAssetProposal', () => {
  const proposal: AssetUpdateProposal = {
    id: 'p1',
    summary: 'Apply',
    createdAt: 0,
    updates: [
      {
        assetId: 'a1',
        symbol: 'HDFCBANK.NS',
        name: 'HDFC Bank',
        currency: 'INR',
        changes: [
          { field: 'quantity', from: 10, to: 12 },
          { field: 'manualPrice', from: null, to: 1650 },
        ],
      },
    ],
  };

  it('updates only the target asset without mutating the input', () => {
    const next = applyAssetProposal(assets, proposal);

    expect(next[0]).toMatchObject({ quantity: 12, manualPrice: 1650 });
    expect(next[0]).not.toBe(assets[0]);
    expect(next[1]).toBe(assets[1]);
    expect(assets[0].quantity).toBe(10);
    expect(assets[0].manualPrice).toBeUndefined();
  });
});

describe('mergeAssetProposals', () => {
  it('combines tool calls from one turn into a single card', () => {
    const merged = mergeAssetProposals([
      {
        id: 'p1',
        summary: 'First',
        createdAt: 1,
        updates: [
          {
            assetId: 'a1',
            symbol: 'HDFCBANK.NS',
            name: 'HDFC Bank',
            currency: 'INR',
            changes: [{ field: 'quantity', from: 10, to: 11 }],
          },
        ],
      },
      {
        id: 'p2',
        summary: 'Second',
        createdAt: 2,
        updates: [
          {
            assetId: 'a1',
            symbol: 'HDFCBANK.NS',
            name: 'HDFC Bank',
            currency: 'INR',
            changes: [
              { field: 'quantity', from: 10, to: 12 },
              { field: 'entryPrice', from: 100, to: 110 },
            ],
          },
          {
            assetId: 'a2',
            symbol: 'MF_140084',
            name: 'Nifty 50 Index Fund',
            currency: 'INR',
            changes: [{ field: 'entryPrice', from: 42.125, to: 43 }],
          },
        ],
      },
    ]);

    expect(merged?.updates).toHaveLength(2);
    expect(merged?.updates[0].changes).toEqual([
      { field: 'quantity', from: 10, to: 12 },
      { field: 'entryPrice', from: 100, to: 110 },
    ]);
  });

  it('returns null for an empty list', () => {
    expect(mergeAssetProposals([])).toBeNull();
  });
});
