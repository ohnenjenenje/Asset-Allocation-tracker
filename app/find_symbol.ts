import { yahooSearch } from '../lib/market/yahoo';

async function findSymbol() {
  const query = 'Edelweiss Liquid Fund Retail Growth';
  console.log(`Searching for: ${query}`);
  const results = await yahooSearch(query);
  console.log(JSON.stringify(results, null, 2));
}

findSymbol().catch((error) => console.error(error));
