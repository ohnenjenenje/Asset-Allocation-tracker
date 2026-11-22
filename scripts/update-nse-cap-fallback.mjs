/**
 * Regenerates lib/market/nseCapFallback.ts from the official NSE index lists.
 *
 * Usage: node scripts/update-nse-cap-fallback.mjs
 *
 * The API refreshes these lists at runtime. This snapshot only exists so a
 * blocked egress path cannot silently misclassify Indian stocks.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCES = [
  'https://nsearchives.nseindia.com/content/indices',
  'https://www.niftyindices.com/IndexConstituent',
];

const LISTS = [
  { file: 'ind_nifty100list.csv', category: 'Large Cap' },
  { file: 'ind_niftymidcap150list.csv', category: 'Mid Cap' },
  { file: 'ind_niftysmallcap250list.csv', category: 'Small Cap' },
];

const OUTPUT = path.join(process.cwd(), 'lib/market/nseCapFallback.ts');

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

async function download(file) {
  let lastError;
  for (const base of SOURCES) {
    try {
      const response = await fetch(`${base}/${file}`, {
        headers: {
          Accept: 'text/csv,text/plain,*/*',
          'User-Agent': 'Mozilla/5.0 (compatible; AssetTracker/0.1)',
        },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const csv = await response.text();
      if (!csv.toLowerCase().includes('symbol')) throw new Error('missing Symbol header');
      return csv;
    } catch (error) {
      lastError = error;
      console.warn(`[nse-cap] ${base}/${file} failed: ${error.message}`);
    }
  }
  throw lastError;
}

function extractSymbols(csv) {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = parseCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const symbolIndex = header.indexOf('symbol');
  if (symbolIndex < 0) throw new Error('missing Symbol column');

  const symbols = new Set();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const symbol = parseCsvLine(line)[symbolIndex]?.trim().toUpperCase();
    if (symbol) symbols.add(symbol);
  }
  return [...symbols].sort();
}

function block(symbols) {
  const lines = [];
  for (let index = 0; index < symbols.length; index += 8) {
    lines.push(`  ${symbols.slice(index, index + 8).join(' ')}`);
  }
  return lines.join('\n');
}

const groups = {};
for (const { file, category } of LISTS) {
  const csv = await download(file);
  groups[category] = extractSymbols(csv);
  console.log(`${category}: ${groups[category].length} symbols`);
}

const content = `/**
 * Offline snapshot of NSE index membership for Indian market-cap buckets.
 *
 * The runtime loader refreshes from NSE and Nifty Indices every 12 hours. This
 * snapshot is the last-resort fallback for hosts whose egress is blocked by
 * Akamai, so a stale or unit-mangled provider market cap can never demote a
 * Nifty 100 stock (for example HDFC Bank) to Small Cap.
 *
 * Regenerate after index rebalances:
 *   node scripts/update-nse-cap-fallback.mjs
 */

export type NseCapCategory = 'Large Cap' | 'Mid Cap' | 'Small Cap';

const LARGE_CAP = \`
${block(groups['Large Cap'])}
\`.trim().split(/\\s+/);

const MID_CAP = \`
${block(groups['Mid Cap'])}
\`.trim().split(/\\s+/);

const SMALL_CAP = \`
${block(groups['Small Cap'])}
\`.trim().split(/\\s+/);

export const NSE_CAP_FALLBACK: Record<string, NseCapCategory> = Object.fromEntries([
  ...LARGE_CAP.map((symbol) => [symbol, 'Large Cap'] as const),
  ...MID_CAP.map((symbol) => [symbol, 'Mid Cap'] as const),
  ...SMALL_CAP.map((symbol) => [symbol, 'Small Cap'] as const),
]);
`;

await fs.writeFile(OUTPUT, content);
console.log(`wrote ${path.relative(process.cwd(), OUTPUT)} (${content.length} bytes)`);
