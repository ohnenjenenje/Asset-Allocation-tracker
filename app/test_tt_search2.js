async function test() {
  const url = `https://api.tickertape.in/search?text=${encodeURIComponent('HDFC Flexi Cap Fund')}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  });
  console.log(res.status);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2).substring(0, 500));
}
test();
