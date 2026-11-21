// Champion lookup + image URLs from Riot's Data Dragon.
// Accepts whatever the scraper finds: "Kai'Sa", "Kaisa", "kaisa", "MonkeyKing", "Wukong", "145"...

let version = '14.23.1';
let champs = [];                 // [{ id: 'Kaisa', name: "Kai'Sa", key: '145' }]
const index = new Map();         // normalized string → champ
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

export async function loadChampions() {
  try {
    const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
    version = versions[0];
    const data = (await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`)).json()).data;
    champs = Object.values(data).map(c => ({ id: c.id, name: c.name, key: c.key }));
    for (const c of champs) { index.set(norm(c.id), c); index.set(norm(c.name), c); index.set(c.key, c); }
  } catch (e) {
    console.warn('[ddragon] could not load champion list – showing raw names', e);
  }
  return champs;
}

export function resolve(raw) {
  if (!raw) return null;
  return index.get(norm(raw)) || index.get(String(raw)) || { id: String(raw), name: String(raw), key: null, unknown: true };
}

export const allChampions = () => champs;

export const img = {
  icon:    id => `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${id}.png`,
  loading: id => `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${id}_0.jpg`,   // tall 308x560
  splash:  id => `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${id}_0.jpg`,    // wide 1215x717
};
