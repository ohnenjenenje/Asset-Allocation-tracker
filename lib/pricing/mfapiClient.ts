// SRP: mutual-fund fetching; OCP: extend without editing price route

export const mfapiClient = {
  async getByAmfiCode(amfiCode: string) {
    const res = await fetch(`https://api.mfapi.in/mf/${amfiCode}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.data?.length) return null;
    return data as { meta: { scheme_name: string; scheme_category?: string }; data: { nav: string }[] };
  },

  async searchByName(cleanName: string) {
    const res = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(cleanName)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },
};

export const cleanFundNameForSearch = (name: string): string =>
  name
    .replace(/Direct Plan/gi, '')
    .replace(/Regular Plan/gi, '')
    .replace(/Direct/gi, '')
    .replace(/Regular/gi, '')
    .replace(/Growth/gi, '')
    .replace(/IDCW/gi, '')
    .replace(/Dividend/gi, '')
    .replace(/Option/gi, '')
    .replace(/Plan/gi, '')
    .replace(/Scheme/gi, '')
    .replace(/Index Fund/gi, '')
    .replace(/Fund/gi, '')
    .replace(/Index/gi, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
