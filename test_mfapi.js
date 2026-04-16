async function test() {
  const res = await fetch('https://api.mfapi.in/mf/search?q=INE342T07635');
  console.log(await res.text());
}
test();
