import yahooFinance from 'yahoo-finance2';

async function test() {
  try {
    const res = await yahooFinance.quote('AAPL');
    console.log("AAPL:", res.regularMarketPrice);
  } catch(e) { console.error(e); }
}
test();
