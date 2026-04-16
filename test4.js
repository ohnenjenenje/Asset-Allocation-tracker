import yahooFinance from 'yahoo-finance2';

async function test() {
  try {
    const yahoo = new yahooFinance();
    const res = await yahoo.search('INE342T07635');
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error(e);
  }
}
test();
