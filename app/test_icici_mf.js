
async function test() {
  const query = 'ICICI prudential nifty 50 index fund';
  const res = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  console.log(JSON.stringify(data.slice(0, 5), null, 2));
}
test();
