import { createAirwayResolver } from '../radar/airways.js';

export async function loadJSON(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error('Failed to load '+url);
  return res.json();
}

export async function loadAirways(navigationIndex){
  const data = await loadJSON(new URL('../../assets/navigation/pansa-airways.json', import.meta.url));
  return createAirwayResolver(data, navigationIndex);
}
