'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Filter, ArrowUpDown, ChevronRight, TrendingUp, TrendingDown, ExternalLink, Loader2, Plus } from 'lucide-react';

type ScreenerResult = {
  sid: string;
  ticker: string;
  name: string;
  sector: string;
  marketCap: number;
  peRatio: number;
  pbRatio: number;
  divYield: number;
  price: number;
  change: number;
  pchange: number;
};

const SECTORS = [
  "All Sectors", "Financials", "Information Technology", "Health Care", "Consumer Discretionary", 
  "Consumer Staples", "Industrials", "Materials", "Energy", "Utilities", "Communication Services", "Real Estate"
];

const MARKET_CAPS = [
  { label: "All", val: 0 },
  { label: "> 10,000 Cr", val: 100000000000 },
  { label: "> 50,000 Cr", val: 500000000000 },
  { label: "> 1,00,000 Cr", val: 1000000000000 }
];

type ScreenerProps = {
  onAdd: (ticker: string) => void;
};

export default function Screener({ onAdd }: ScreenerProps) {
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    sector: "All Sectors",
    minMarketCap: 0,
    maxPE: 100,
    minDivYield: 0
  });
  const [sort, setSort] = useState({ key: "marketCap", order: -1 });

  const fetchResults = async () => {
    setLoading(true);
    setError(null);
    try {
      const tickertapeFilters: any[] = [];
      
      if (filters.sector !== "All Sectors") {
        tickertapeFilters.push({ id: "sector", op: "eq", val: filters.sector });
      }
      
      if (filters.minMarketCap > 0) {
        tickertapeFilters.push({ id: "marketCap", op: "gt", val: filters.minMarketCap });
      }

      if (filters.maxPE < 100) {
        tickertapeFilters.push({ id: "peRatio", op: "lt", val: filters.maxPE });
      }

      if (filters.minDivYield > 0) {
        tickertapeFilters.push({ id: "divYield", op: "gt", val: filters.minDivYield });
      }

      const response = await fetch('/api/screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: tickertapeFilters,
          sort: sort.key,
          order: sort.order,
          limit: 50
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);
      
      // Tickertape returns data in a specific format: { data: { results: [...] } }
      const resultsArray = data?.data?.results || [];
      
      const mappedResults = resultsArray.map((r: any) => ({
        sid: r.sid || Math.random().toString(36).substr(2, 9),
        ticker: r.stock?.ticker || 'N/A',
        name: r.stock?.name || 'Unknown',
        sector: r.stock?.sector || 'Other',
        marketCap: r.marketCap || 0,
        peRatio: r.peRatio || 0,
        pbRatio: r.pbRatio || 0,
        divYield: r.divYield || 0,
        price: r.price || 0,
        change: r.change || 0,
        pchange: r.pchange || 0
      }));

      setResults(mappedResults);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResults();
  }, [filters, sort]);

  const formatCurrency = (val: number) => {
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)}Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(2)}L`;
    return `₹${val.toLocaleString('en-IN')}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <Filter className="w-6 h-6 text-blue-500" />
            Stock Screener
          </h2>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">
            Discover stocks using advanced filters powered by Tickertape
          </p>
        </div>
        <button 
          onClick={fetchResults}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Refresh Results
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Sector</label>
          <select 
            value={filters.sector}
            onChange={(e) => setFilters(f => ({ ...f, sector: e.target.value }))}
            className="w-full p-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Market Cap</label>
          <select 
            value={filters.minMarketCap}
            onChange={(e) => setFilters(f => ({ ...f, minMarketCap: Number(e.target.value) }))}
            className="w-full p-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {MARKET_CAPS.map(m => <option key={m.label} value={m.val}>{m.label}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Max PE Ratio ({filters.maxPE})</label>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={filters.maxPE}
            onChange={(e) => setFilters(f => ({ ...f, maxPE: Number(e.target.value) }))}
            className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Min Div Yield ({filters.minDivYield}%)</label>
          <input 
            type="range" 
            min="0" 
            max="10" 
            step="0.5"
            value={filters.minDivYield}
            onChange={(e) => setFilters(f => ({ ...f, minDivYield: Number(e.target.value) }))}
            className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
                <th className="p-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Stock</th>
                <th className="p-4 text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-blue-500 transition-colors" onClick={() => setSort({ key: 'price', order: sort.order * -1 })}>
                  Price <ArrowUpDown className="w-3 h-3 inline ml-1" />
                </th>
                <th className="p-4 text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-blue-500 transition-colors" onClick={() => setSort({ key: 'pchange', order: sort.order * -1 })}>
                  Change <ArrowUpDown className="w-3 h-3 inline ml-1" />
                </th>
                <th className="p-4 text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-blue-500 transition-colors" onClick={() => setSort({ key: 'marketCap', order: sort.order * -1 })}>
                  Market Cap <ArrowUpDown className="w-3 h-3 inline ml-1" />
                </th>
                <th className="p-4 text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-blue-500 transition-colors" onClick={() => setSort({ key: 'peRatio', order: sort.order * -1 })}>
                  PE Ratio <ArrowUpDown className="w-3 h-3 inline ml-1" />
                </th>
                <th className="p-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Div Yield</th>
                <th className="p-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              <AnimatePresence mode="popLayout">
                {results.map((stock, idx) => (
                  <motion.tr 
                    key={stock.sid}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.02 }}
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors group"
                  >
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-zinc-900 dark:text-white group-hover:text-blue-500 transition-colors">{stock.ticker}</span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-[150px]">{stock.name}</span>
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">{stock.sector}</span>
                      </div>
                    </td>
                    <td className="p-4 font-medium text-zinc-900 dark:text-white">
                      ₹{stock.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4">
                      <div className={`flex items-center gap-1 font-medium ${stock.pchange >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {stock.pchange >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {Math.abs(stock.pchange).toFixed(2)}%
                      </div>
                    </td>
                    <td className="p-4 text-zinc-600 dark:text-zinc-300">
                      {formatCurrency(stock.marketCap)}
                    </td>
                    <td className="p-4 text-zinc-600 dark:text-zinc-300">
                      {stock.peRatio ? stock.peRatio.toFixed(2) : '-'}
                    </td>
                    <td className="p-4 text-zinc-600 dark:text-zinc-300">
                      {stock.divYield ? `${stock.divYield.toFixed(2)}%` : '-'}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => onAdd(stock.ticker)}
                          className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors"
                          title="Add to Portfolio"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                        <a 
                          href={`https://www.tickertape.in/stocks/${stock.name.toLowerCase().replace(/ /g, '-')}-${stock.ticker}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-zinc-400 hover:text-blue-500 transition-colors inline-block"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        
        {results.length === 0 && !loading && (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="w-8 h-8 text-zinc-400" />
            </div>
            <h3 className="text-lg font-medium text-zinc-900 dark:text-white">No stocks found</h3>
            <p className="text-zinc-500 dark:text-zinc-400">Try adjusting your filters to see more results.</p>
          </div>
        )}

        {loading && (
          <div className="p-12 text-center">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
            <p className="text-zinc-500 dark:text-zinc-400">Scanning the market...</p>
          </div>
        )}
      </div>
      
      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-600 dark:text-rose-400 text-sm">
          Error: {error}
        </div>
      )}
    </div>
  );
}
