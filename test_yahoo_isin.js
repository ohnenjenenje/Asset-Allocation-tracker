import yahooFinance from 'yahoo-finance2';
async function test() {
  const yahoo = new yahooFinance();
  try {
    const res = await yahoo.quote('INE342T07635.BO');
    console.log(res);
  } catch(e) { console.log(e.message); }
  try {
    const res2 = await yahoo.quote('INE342T07635.NS');
    console.log(res2);
  } catch(e) { console.log(e.message); }
}
test();
