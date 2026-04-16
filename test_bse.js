async function test() {
  try {
    const res = await fetch('https://api.bseindia.com/BseIndiaAPI/api/GetScripHeaderData/w?Debtflag=&scripcode=INE342T07635', {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });
    const data = await res.text();
    console.log(data);
  } catch (e) {
    console.error(e);
  }
}
test();
