async function test() {
  const res = await fetch('https://api.bseindia.com/BseIndiaAPI/api/BSEIndiaSearch/w?text=INE342T07635&flag=0', {
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
