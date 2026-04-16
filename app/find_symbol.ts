
import YahooFinance from 'yahoo-finance2';
const yahoo = new YahooFinance();

async function findSymbol() {
  const query = "Edelweiss Liquid Fund Retail Growth";
  console.log(`Searching for: ${query}`);
  try {
    const results = await yahoo.search(query);
    console.log(JSON.stringify(results.quotes, null, 2));
  } catch (e) {
    console.error(e);
  }
}

findSymbol();
