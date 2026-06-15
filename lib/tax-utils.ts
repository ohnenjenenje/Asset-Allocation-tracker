import { Asset } from './types';

const GOLD_IMPORT_DUTY_PERCENT = 15;
const GST_PERCENT = 3;
const LTCG_RATE = 12.5;
const EQUITY_LTCG_RATE = 12.5;
const EQUITY_STCG_RATE = 20;
const EQUITY_LTCG_EXEMPTION = 125000;

type AssetTaxClass = 'physical_gold_silver' | 'gold_silver_etf_mf' | 'sgb' | 'equity' | 'equity_mf' | 'debt_mf' | 'crypto' | 'unknown';

type TaxResult = {
  taxClass: AssetTaxClass;
  holdingMonths: number | null;
  isLongTerm: boolean | null;
  gain: number;
  taxableGain: number;
  estimatedTax: number;
  taxRate: number | null;
  taxLabel: string;
  importDuty: number;
  gst: number;
  totalAcquisitionCost: number;
  notes: string[];
};

function getMonthsDiff(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function classifyAsset(asset: Asset, categoryPath?: string[]): AssetTaxClass {
  const sym = asset.symbol.toUpperCase();
  const name = (asset.name || '').toLowerCase();
  const type = (asset.type || '').toUpperCase();
  const cat = (categoryPath?.[0] || '').toLowerCase();

  if (sym === 'GOLD-INR-GRAM' || sym === 'SILVER-INR-GRAM') return 'physical_gold_silver';

  if (/sgb|sovereign.?gold.?bond/i.test(name)) return 'sgb';

  const isGoldSilverFund = /gold|silver/i.test(name) && (type === 'ETF' || type === 'MUTUALFUND');
  if (isGoldSilverFund) return 'gold_silver_etf_mf';

  if (cat === 'crypto' || type === 'CRYPTOCURRENCY') return 'crypto';

  if (type === 'ETF' || type === 'EQUITY' || type === 'STOCK') return 'equity';

  if (type === 'MUTUALFUND') {
    const catName = (categoryPath?.join(' ') || name).toLowerCase();
    if (/debt|bond|gilt|credit|liquid|money.?market|overnight|floater|income|dynamic|short|medium|long.?duration/i.test(catName)) {
      return 'debt_mf';
    }
    return 'equity_mf';
  }

  if (cat === 'equities') return 'equity';
  if (cat === 'commodities') return 'physical_gold_silver';

  return 'unknown';
}

function getLtcgThresholdMonths(taxClass: AssetTaxClass): number {
  switch (taxClass) {
    case 'physical_gold_silver': return 24;
    case 'gold_silver_etf_mf': return 24;
    case 'sgb': return 36;
    case 'equity': return 12;
    case 'equity_mf': return 12;
    case 'debt_mf': return 24;
    case 'crypto': return 12;
    default: return 24;
  }
}

export function calculateTax(
  asset: Asset,
  currentPrice: number,
  categoryPath?: string[],
): TaxResult {
  const taxClass = classifyAsset(asset, categoryPath);
  const gain = (currentPrice - asset.entryPrice) * asset.quantity;
  const notes: string[] = [];

  let holdingMonths: number | null = null;
  let isLongTerm: boolean | null = null;

  if (asset.purchaseDate) {
    const purchaseDate = new Date(asset.purchaseDate);
    if (!isNaN(purchaseDate.getTime())) {
      holdingMonths = getMonthsDiff(purchaseDate, new Date());
      const threshold = getLtcgThresholdMonths(taxClass);
      isLongTerm = holdingMonths > threshold;
    }
  }

  let importDuty = 0;
  let gst = 0;
  const investedValue = asset.entryPrice * asset.quantity;

  if (taxClass === 'physical_gold_silver') {
    importDuty = investedValue * (GOLD_IMPORT_DUTY_PERCENT / 100);
    gst = investedValue * (GST_PERCENT / 100);
    notes.push(`Import duty ${GOLD_IMPORT_DUTY_PERCENT}% + GST ${GST_PERCENT}% included in acquisition cost`);
  }

  const totalAcquisitionCost = investedValue + importDuty + gst;
  const adjustedGain = (currentPrice * asset.quantity) - totalAcquisitionCost;

  let taxRate: number | null = null;
  let estimatedTax = 0;
  let taxableGain = Math.max(0, adjustedGain);
  let taxLabel = '';

  if (gain <= 0) {
    taxLabel = 'No tax (loss)';
    taxableGain = 0;
    estimatedTax = 0;
  } else if (isLongTerm === null) {
    taxLabel = 'Add purchase date for tax estimate';
    notes.push('Purchase date needed to determine LTCG vs STCG');
  } else if (taxClass === 'sgb' && isLongTerm) {
    taxLabel = 'Exempt (SGB maturity)';
    taxableGain = 0;
    notes.push('SGBs held to maturity are exempt from capital gains tax');
  } else if (taxClass === 'crypto') {
    taxRate = 30;
    taxableGain = Math.max(0, gain);
    estimatedTax = taxableGain * (taxRate / 100);
    taxLabel = `Crypto flat ${taxRate}%`;
    notes.push('Flat 30% tax on crypto gains, no distinction between LTCG/STCG');
  } else if (isLongTerm) {
    taxRate = LTCG_RATE;
    taxLabel = `LTCG ${taxRate}%`;
    notes.push('No indexation benefit (removed Budget 2024)');

    if (taxClass === 'equity' || taxClass === 'equity_mf') {
      taxRate = EQUITY_LTCG_RATE;
      taxableGain = Math.max(0, taxableGain - EQUITY_LTCG_EXEMPTION);
      taxLabel = `LTCG ${taxRate}% (after ₹1.25L exemption)`;
      notes.push(`₹${EQUITY_LTCG_EXEMPTION.toLocaleString('en-IN')} annual exemption on equity LTCG`);
    }

    estimatedTax = taxableGain * (taxRate / 100);
  } else {
    if (taxClass === 'equity' || taxClass === 'equity_mf') {
      taxRate = EQUITY_STCG_RATE;
      taxableGain = Math.max(0, gain);
      estimatedTax = taxableGain * (taxRate / 100);
      taxLabel = `STCG ${taxRate}%`;
    } else {
      taxLabel = 'STCG (slab rate)';
      taxableGain = Math.max(0, adjustedGain);
      notes.push('Short-term gains taxed at your income tax slab rate');
    }
  }

  return {
    taxClass,
    holdingMonths,
    isLongTerm,
    gain,
    taxableGain,
    estimatedTax,
    taxRate,
    taxLabel,
    importDuty,
    gst,
    totalAcquisitionCost,
    notes,
  };
}

export function formatHoldingPeriod(months: number): string {
  if (months < 1) return '<1 mo';
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years}y ${rem}m` : `${years}y`;
}

export function getTaxClassLabel(taxClass: AssetTaxClass): string {
  switch (taxClass) {
    case 'physical_gold_silver': return 'Physical Gold/Silver';
    case 'gold_silver_etf_mf': return 'Gold/Silver ETF/MF';
    case 'sgb': return 'Sovereign Gold Bond';
    case 'equity': return 'Equity';
    case 'equity_mf': return 'Equity MF';
    case 'debt_mf': return 'Debt MF';
    case 'crypto': return 'Crypto';
    default: return 'Other';
  }
}
