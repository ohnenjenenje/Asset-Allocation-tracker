async function test() {
  const url = `http://localhost:3000/api/price?symbols=GOLD-INR-GRAM&refresh=true`;
  const res = await fetch(url);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
test();
