async function test() {
  const res = await fetch('https://stock.indianapi.in/search?query=Navi Finserv', {
    headers: {
      'X-API-Key': 'sk-live-P8P1GUhO1Ljk6I5rTky5JK5CFwbQ5xdjX0kp2zfE'
    }
  });
  console.log(await res.text());
}
test();
