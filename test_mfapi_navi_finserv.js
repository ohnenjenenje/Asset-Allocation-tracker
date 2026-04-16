async function test() {
  const res = await fetch('https://api.mfapi.in/mf/search?q=Navi Finserv');
  console.log(await res.text());
}
test();
