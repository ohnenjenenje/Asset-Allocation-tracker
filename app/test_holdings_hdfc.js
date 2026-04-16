const http = require('http');
http.get('http://localhost:3000/api/holdings?symbol=MF_118955&name=HDFC%20Flexi%20Cap%20Fund', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log(data));
});
