import { readFile } from 'node:fs/promises';
import { createNavigationIndex } from '../src/radar/routes.js';
import { createAirwayResolver } from '../src/radar/airways.js';
import { createFirBoundary } from '../src/radar/fir-boundary.js';
import { parseRouteCatalogue, compileRouteCatalogue } from '../src/radar/route-catalogue.js';
import { parseRouteAircraft, applyRouteAircraft } from '../src/radar/route-aircraft.js';
import { createSectorIndex } from '../src/radar/sectors.js';
import { createAirspaceIndex } from '../src/radar/airspace.js';
import { addTerminalNavigation } from '../src/radar/terminal-routes.js';

export async function loadSimulationData(){
  const text=p=>readFile(new URL('../'+p,import.meta.url),'utf8'),json=async p=>JSON.parse(await text(p));
  const manifest=await json('assets/manifest.json');
  const loaded=await Promise.all(manifest.geojson.map(async entry=>({entry,data:await json(entry.path)})));
  const navigationIndex=createNavigationIndex(loaded.filter(v=>['WAYPOINTS','AIRPORTS'].includes(v.entry.layer)).map(v=>v.data));
  addTerminalNavigation(navigationIndex);
  const resolver=createAirwayResolver(await json('assets/navigation/pansa-airways.json'),navigationIndex);
  const firs=loaded.find(v=>v.entry.layer==='FIR').data;
  const sectorIndex=createSectorIndex(loaded.filter(v=>['SECTOR_LOW','SECTOR_HIGH','TMA'].includes(v.entry.layer)).map(v=>v.data));
  const airspaceIndex=createAirspaceIndex(sectorIndex,firs);
  if(!airspaceIndex.complete)throw Error('Airspace data is incomplete.');
  const catalogue=applyRouteAircraft(compileRouteCatalogue(parseRouteCatalogue(await text('assets/sources/Airporty_revamped.txt')),resolver,createFirBoundary(firs)),parseRouteAircraft(await text('assets/sources/route-aircraft-types.txt')));
  return {navigationIndex,sectorIndex,airspaceIndex,catalogue};
}
