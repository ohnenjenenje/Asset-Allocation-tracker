const https = require('https');
https.get('https://openrouter.ai/api/v1/models', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    console.log(JSON.stringify(json.data.slice(0, 5), null, 2));
    const free = json.data.filter(m => m.pricing && m.pricing.prompt === "0" && m.pricing.completion === "0");
    console.log("Free models count:", free.length);
    console.log(JSON.stringify(free.slice(0, 5), null, 2));
  });
});
