async function test() {
  const res = await fetch('http://localhost:3000/api/search?q=hdfc%20flexi%20cap%20fund');
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
test();
