const https = require('https');

https.get('https://raw.githubusercontent.com/captn3m0/india-isin-data/main/ISIN.csv', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const anyIndex = data.indexOf('INE342T07635');
    console.log("Index:", anyIndex);
    if (anyIndex !== -1) {
      console.log("Context:", data.substring(Math.max(0, anyIndex - 50), Math.min(data.length, anyIndex + 100)));
    }
  });
}).on('error', (err) => {
  console.error(err);
});
