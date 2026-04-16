async function test() {
  // Trying to find a search or quote endpoint for indiabonds.com
  // This is a guess based on common patterns, as I don't have the exact API endpoint.
  const res = await fetch('https://api.indiabonds.com/v1/search?q=INE342T07635', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://www.indiabonds.com/',
      'Origin': 'https://www.indiabonds.com'
    }
  });
  console.log(res.status);
  console.log(await res.text());
}
test();
