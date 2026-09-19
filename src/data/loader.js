import { createAirwayResolver } from '../radar/airways.js';
import { parseRouteCatalogue, compileRouteCatalogue } from '../radar/route-catalogue.js';
import { createFirBoundary } from '../radar/fir-boundary.js';
import { createAircraftSpawner } from '../radar/spawner.js';

export async function loadJSON(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error('Failed to load '+url);
  return res.json();
}

export async function loadAirways(navigationIndex){
  const data = await loadJSON(new URL('../../assets/navigation/pansa-airways.json', import.meta.url));
  return createAirwayResolver(data, navigationIndex);
}

export async function loadAircraftSpawner(resolver,firCollection){
  const url=new URL('../../assets/sources/Airporty_revamped.txt',import.meta.url);
  const response=await fetch(url);
  if(!response.ok)throw new Error('Failed to load the route catalogue.');
  const catalogue=compileRouteCatalogue(parseRouteCatalogue(await response.text()),resolver,createFirBoundary(firCollection));
  return createAircraftSpawner(catalogue);
}
