import yahooFinance from 'yahoo-finance2';
async function test() {
  const yahoo = new yahooFinance();
  const result = await yahoo.quote('0P0000XW8F.BO');
  console.log(result.longName);
  
  const res = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(result.longName)}`);
  console.log(await res.json());
}
test();
