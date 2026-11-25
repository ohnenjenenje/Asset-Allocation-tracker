const query = 'Edelweiss Liquid Fund Retail Growth';
const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
  query,
)}&quotesCount=10&newsCount=0`;

fetch(url, {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json',
  },
})
  .then((response) => response.json())
  .then((data) => console.log(JSON.stringify(data.quotes, null, 2)))
  .catch((error) => console.error(error));
