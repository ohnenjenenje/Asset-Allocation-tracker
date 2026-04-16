async function test() {
  const res = await fetch('https://api.mfapi.in/mf/search?q=INF204KB1882'); // Random ISIN for Navi Nifty 50
  console.log(await res.text());
}
test();
