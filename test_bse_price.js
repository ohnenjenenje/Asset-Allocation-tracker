async function test() {
  const res = await fetch('https://api.bseindia.com/BseIndiaAPI/api/StockReachGraph/w?scripcode=938035&flag=0&fromdate=&todate=&seriesid=', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://www.bseindia.com/',
      'Origin': 'https://www.bseindia.com'
    }
  });
  console.log(await res.text());
}
test();
