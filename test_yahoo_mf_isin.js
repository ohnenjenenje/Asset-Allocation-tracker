import yahooFinance from 'yahoo-finance2';
async function test() {
  const yahoo = new yahooFinance();
  const res = await yahoo.search('INF204KB1882');
  console.log(JSON.stringify(res, null, 2));
}
test();
