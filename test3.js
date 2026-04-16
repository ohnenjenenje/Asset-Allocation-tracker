const https = require('https');

https.get('https://raw.githubusercontent.com/captn3m0/india-isin-data/main/ISIN.csv', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const lines = data.split('\n');
    const matches = lines.filter(line => line.includes('INE342T'));
    console.log("Matches:", matches);
  });
}).on('error', (err) => {
  console.error(err);
});
