async function test() {
  const res = await fetch('https://api.mfapi.in/mf/112408');
  console.log(await res.text());
}
test();
