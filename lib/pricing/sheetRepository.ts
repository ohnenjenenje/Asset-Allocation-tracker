// DIP: abstraction over Google Sheets; enables mocking / swapping storage
import { SHEET_CACHE_TTL_MS, SHEET_HEADER } from '@/lib/constants';
import { GoogleAuth } from 'google-auth-library';

export interface SheetPriceRow {
  symbol: string;
  regularMarketPrice: number | null;
  shortName: string;
  currency: string;
  quoteType: string;
  marketCap: number;
  yahooSymbol: string | null;
  sector: string | null;
  source: string | null;
}

let cachedSheetData: any = null;
let lastSheetFetch = 0;

export const sheetRepository = {
  async getAuthToken(): Promise<string | null> {
    if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEET_ID) return null;
    try {
      const auth = new GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      const client = await auth.getClient();
      const token = await client.getAccessToken();
      return token.token ?? null;
    } catch (e) {
      console.error('Failed to init Google Sheets Auth', e);
      return null;
    }
  },

  async readAll(token: string, sheetId: string, refresh: boolean): Promise<any> {
    const now = Date.now();
    if (cachedSheetData && now - lastSheetFetch < SHEET_CACHE_TTL_MS && !refresh) return cachedSheetData;
    console.log('Fetching sheet data from Google...');
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:I?valueRenderOption=UNFORMATTED_VALUE`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch sheet data: ${res.status} ${await res.text().then(t => t.substring(0, 200))}`);
    const data = await res.json();
    cachedSheetData = data;
    lastSheetFetch = now;
    console.log('Successfully fetched and cached sheet data.');
    return data;
  },

  parseRows(values: any[][]): { existingData: Record<string, SheetPriceRow>; existingSymbols: Set<string> } {
    const existingData: Record<string, SheetPriceRow> = {};
    const existingSymbols = new Set<string>();
    const startIndex = values.length > 0 && Array.isArray(values[0]) && typeof values[0][0] === 'string' && values[0][0].toLowerCase() === 'symbol' ? 1 : 0;
    for (let i = startIndex; i < values.length; i++) {
      const row = values[i];
      if (!row || !Array.isArray(row) || row.length === 0) continue;
      const sym = typeof row[0] === 'string' ? row[0].toUpperCase() : String(row[0]);
      if (sym && sym !== 'UNDEFINED') {
        existingSymbols.add(sym);
        const priceVal = row[1];
        let price: number | null = null;
        if (typeof priceVal === 'number') price = priceVal;
        else if (typeof priceVal === 'string' && !priceVal.includes('#N/A') && !priceVal.includes('Loading')) {
          const parsed = parseFloat(priceVal.replace(/[^0-9.-]+/g, ''));
          if (!isNaN(parsed)) price = parsed;
        }
        existingData[sym] = {
          symbol: sym,
          regularMarketPrice: price,
          shortName: row[2] || sym,
          currency: String(row[3] || 'USD').replace(/^"|"$/g, ''),
          quoteType: String(row[4] || 'EQUITY').replace(/^"|"$/g, ''),
          marketCap: typeof row[5] === 'number' ? row[5] : parseFloat(String(row[5] || '').replace(/[^0-9.-]+/g, '')),
          yahooSymbol: row[6] || null,
          sector: row[7] || null,
          source: row[8] || null,
        };
      }
    }
    return { existingData, existingSymbols };
  },

  async ensureHeader(token: string, sheetId: string, rows: any[][]) {
    if (rows.length === 0 || rows[0].length < 9) {
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:I1?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[...SHEET_HEADER]] }),
      });
      if (!res.ok) throw new Error(`Failed to write headers: ${res.status} ${await res.text()}`);
    }
  },

  async batchUpdate(token: string, sheetId: string, updates: { range: string; values: any[][] }[]) {
    if (updates.length === 0) return;
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
    });
    if (!res.ok) throw new Error(`Failed to batch update: ${res.status} ${await res.text()}`);
  },

  async appendRows(token: string, sheetId: string, rows: any[][]) {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:I:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    });
    if (!res.ok) throw new Error(`Failed to append: ${res.status} ${await res.text()}`);
  },
};
