import yf from 'yahoo-finance2';
console.log(typeof yf);
console.log(Object.keys(yf));
try {
  const instance = new yf();
  console.log(typeof instance.search);
} catch (e) {
  console.error(e);
}
