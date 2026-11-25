fetch(
  'https://query2.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d',
  {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
)
  .then((response) => response.json())
  .then((data) =>
    console.log('AAPL:', data?.chart?.result?.[0]?.meta?.regularMarketPrice),
  )
  .catch((error) => console.error(error));
