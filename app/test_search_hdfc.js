const http = require('http');
http.get('http://localhost:3000/api/search?q=hdfc%20flexi%20cap%20fund', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log(data));
});
