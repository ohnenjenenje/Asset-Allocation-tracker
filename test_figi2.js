async function test() {
  try {
    const res = await fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        { idType: 'ID_ISIN', idValue: 'INE002A01018' }, // Reliance Industries
        { idType: 'ID_ISIN', idValue: 'INF200K01171' }  // SBI Bluechip Fund
      ])
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
}
test();
