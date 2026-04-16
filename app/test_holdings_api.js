async function test() {
  const url = `http://localhost:3000/api/holdings?symbol=MF_101762&name=` + encodeURIComponent('HDFC Flexi Cap Fund - Growth Plan');
  const res = await fetch(url);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
test();
