
async function checkModels() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    const data = await res.json();
    const gemmaModels = data.data.filter(m => m.id.toLowerCase().includes('gemma'));
    console.log(JSON.stringify(gemmaModels, null, 2));
  } catch (e) {
    console.error(e);
  }
}
checkModels();
