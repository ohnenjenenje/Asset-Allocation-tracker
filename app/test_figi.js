async function test() {
  try {
    const res = await fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([{ idType: 'ID_ISIN', idValue: 'INE342T07635' }])
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
}
test();
