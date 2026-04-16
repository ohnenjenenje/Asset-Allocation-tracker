const http = require('http');
http.get('http://localhost:3000/api/price?symbols=MF_118955', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log(data));
});
