// DIP: metals price source abstraction

export const metalsClient = {
  async getUsdPrice(metal: 'gold' | 'silver'): Promise<number | null> {
    if (!process.env.METALS_API_KEY) return null;
    try {
      const res = await fetch(`https://api.metals.dev/v1/latest?api_key=${process.env.METALS_API_KEY}&currency=USD&metals=${metal}`);
      if (res.ok) {
        const data = await res.json();
        if (data.metals?.[metal]) return parseFloat(data.metals[metal]);
      }
    } catch (e) {
      console.error(`Failed to fetch metal price for ${metal}`, e);
    }
    return null;
  },
};
