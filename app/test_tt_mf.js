const https = require('https');
https.get('https://api.tickertape.in/mf/MF_101762/portfolio', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log(res.statusCode, data.substring(0, 200)));
});
