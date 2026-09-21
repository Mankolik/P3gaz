import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createNavigationIndex} from '../src/radar/routes.js';
import {createAirwayResolver} from '../src/radar/airways.js';
import {createFirBoundary} from '../src/radar/fir-boundary.js';
import {parseRouteCatalogue,compileRouteCatalogue} from '../src/radar/route-catalogue.js';
import {parseRouteAircraft,applyRouteAircraft} from '../src/radar/route-aircraft.js';
import {createAircraftSpawner} from '../src/radar/spawner.js';
import {createSectorIndex} from '../src/radar/sectors.js';
import {createAirspaceIndex} from '../src/radar/airspace.js';
import {aircraftCeiling} from '../src/radar/performance.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const json=p=>JSON.parse(read(p));

test('all 251 compiled route variants produce finite, bounded trajectories with real airspace geometry',()=>{
  const entries=json('assets/manifest.json').geojson;
  const navigation=createNavigationIndex(entries.filter(e=>['WAYPOINTS','AIRPORTS'].includes(e.layer)).map(e=>json(e.path)));
  const resolver=createAirwayResolver(json('assets/navigation/pansa-airways.json'),navigation);
  const firs=json('assets/geojson/flightmap_europe_fir_uir.json');
  const catalogue=applyRouteAircraft(compileRouteCatalogue(parseRouteCatalogue(read('assets/sources/Airporty_revamped.txt')),resolver,createFirBoundary(firs)),
    parseRouteAircraft(read('assets/sources/route-aircraft-types.txt')));
  const airspaceIndex=createAirspaceIndex(createSectorIndex(entries.filter(e=>['SECTOR_LOW','SECTOR_HIGH','TMA'].includes(e.layer)).map(e=>json(e.path))),firs);
  let count=0;
  for(const group of catalogue.groups)for(const variant of group.variants){
    const state={air:{tracks:[],airspaceIndex},map:{}};
    const t=createAircraftSpawner({groups:[{...group,variants:[variant]}]},{random:()=>0.5}).spawn(state);
    assert(t.trajectory.complete,`${group.departure}-${group.destination}: ${t.trajectory.reason}`);
    assert(t.trajectory.points.length>1);assert(t.control.owner);
    for(const p of t.trajectory.points){assert(Number.isFinite(p.level));assert(p.level>=0 && p.level<=aircraftCeiling(t));}
    for(let n=1;n<t.trajectory.sequence.length;n++){
      assert.notEqual(t.trajectory.sequence[n-1].sector,t.trajectory.sequence[n].sector);
      assert(t.trajectory.sequence[n].entry.distanceNm>=t.trajectory.sequence[n-1].entry.distanceNm);
    }
    count++;
  }
  assert.equal(count,251);
});
