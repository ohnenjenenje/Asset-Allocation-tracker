async function test() {
  const figiRes = await fetch('https://api.openfigi.com/v3/mapping', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([{ idType: 'ID_ISIN', idValue: 'INE342T07635' }])
  });
  console.log(await figiRes.text());
}
test();
