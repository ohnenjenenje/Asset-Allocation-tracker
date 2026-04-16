import yahooFinance from 'yahoo-finance2';

async function test() {
  try {
    const yahoo = new yahooFinance();
    const res = await yahoo.search('INE002A01018');
    console.log(JSON.stringify(res.quotes, null, 2));
  } catch (e) {
    console.error(e);
  }
}
test();
