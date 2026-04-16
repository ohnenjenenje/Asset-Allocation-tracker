const https = require('https');
const url = `https://api.tickertape.in/search/suggest?text=hdfc%20flexi%20cap%20fund&types=stock,mf`;
https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log(data));
});
