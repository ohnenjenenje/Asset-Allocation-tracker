import { YahooFinance } from 'yahoo-finance2';

async function test() {
  try {
    const yahooFinance = new YahooFinance();
    const res = await yahooFinance.search('HDFC Flexi Cap Fund');
    console.log(res);
  } catch (e) {
    console.error(e);
  }
}
test();
