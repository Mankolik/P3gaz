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
import {createSectorisation,addSectorGroup,moveSectorMembers,groupAirspace,sectorName,SECTOR_PRESETS,ELEMENTARY_SECTORS} from '../src/radar/sectorisation.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const json=p=>JSON.parse(read(p));

for(const mode of ['ALLFIR','Low/High','North/South layers','Elementary','Mixed'])test(`all 251 route variants produce finite, bounded trajectories: ${mode}`,()=>{
  const entries=json('assets/manifest.json').geojson;
  const navigation=createNavigationIndex(entries.filter(e=>['WAYPOINTS','AIRPORTS'].includes(e.layer)).map(e=>json(e.path)));
  const resolver=createAirwayResolver(json('assets/navigation/pansa-airways.json'),navigation);
  const firs=json('assets/geojson/flightmap_europe_fir_uir.json');
  const catalogue=applyRouteAircraft(compileRouteCatalogue(parseRouteCatalogue(read('assets/sources/Airporty_revamped.txt')),resolver,createFirBoundary(firs)),
    parseRouteAircraft(read('assets/sources/route-aircraft-types.txt')));
  const config=createSectorisation();
  const separate=members=>{const id=addSectorGroup(config);moveSectorMembers(config,members,id);return id;};
  if(mode==='Low/High')separate(SECTOR_PRESETS['ALLFIR H']);
  if(mode==='North/South layers'){
    for(const name of ['NFIR L','NFIR H','SFIR L','SFIR H'])config.controlledId=separate(SECTOR_PRESETS[name]);
  }
  if(mode==='Elementary'){moveSectorMembers(config,ELEMENTARY_SECTORS,null);config.controlledId=config.groups.find(g=>g.members.includes('T:LOW')).id;}
  if(mode==='Mixed')config.controlledId=separate(['T:LOW','C:LOW','T:HIGH','C:HIGH','J:HIGH']);
  const controlledSector=sectorName(config.groups.find(g=>g.id===config.controlledId).members);
  const airspaceIndex=groupAirspace(createAirspaceIndex(createSectorIndex(entries.filter(e=>['SECTOR_LOW','SECTOR_HIGH','TMA'].includes(e.layer)).map(e=>json(e.path))),firs),config);
  let count=0;
  for(const group of catalogue.groups)for(const variant of group.variants){
    const state={air:{tracks:[],airspaceIndex,controlledSector},map:{}};
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
