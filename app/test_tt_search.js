async function test() {
  const url = `https://api.tickertape.in/search/suggest?text=${encodeURIComponent('HDFC Flexi Cap Fund')}&types=mf`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Origin': 'https://www.tickertape.in',
      'Referer': 'https://www.tickertape.in/'
    }
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
test();
