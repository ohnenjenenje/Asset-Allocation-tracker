async function test() {
  try {
    const res = await fetch('https://api.mfapi.in/mf/search?q=INE342T07635');
    const data = await res.json();
    console.log(data);
  } catch (e) {
    console.error(e);
  }
}
test();
