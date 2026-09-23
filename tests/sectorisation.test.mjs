import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SECTOR_PRESETS, ELEMENTARY_SECTORS, createSectorisation, cloneSectorisation, sectorName, addSectorGroup, moveSectorMembers, validateSectorisation, groupAirspace } from '../src/radar/sectorisation.js';
import { createSectorIndex } from '../src/radar/sectors.js';
import { createAirspaceIndex, airspaceAt } from '../src/radar/airspace.js';
import { applySectorisation } from '../src/radar/reconfigure-sectors.js';
import { setFlightPlan } from '../src/radar/routes.js';
import { updateTrafficControl } from '../src/radar/traffic-control.js';
import { buildTrajectory } from '../src/radar/trajectory.js';
import { issueInstruction } from '../src/radar/coordination.js';
import { extendedSectorSequence } from '../src/ui/panels/extended-label-data.js';
import { controlledFootprint } from '../src/render/sector-footprint.js';

const feature=(properties,a,b)=>({type:'Feature',properties,geometry:{type:'Polygon',coordinates:[[[a,-1],[b,-1],[b,1],[a,1],[a,-1]]]}});
const rawIndex=()=>createAirspaceIndex(createSectorIndex([{features:['LOW','HIGH'].flatMap(vertical=>['T','C','J'].map((sector,i)=>
  feature({sector,vertical,min_fl:vertical==='LOW'?95:365,max_fl:vertical==='LOW'?365:660},i*2,(i+1)*2)))}]),
  {features:[feature({AV_AIRSPAC:'EPWWFIR',MIN_FLIGHT:0,MAX_FLIGHT:999},0,6),feature({AV_AIRSPAC:'EDUUUIR',MIN_FLIGHT:0,MAX_FLIGHT:999},-5,0),feature({AV_AIRSPAC:'ESAAFIR',MIN_FLIGHT:0,MAX_FLIGHT:999},6,10)]});
const track=(lon=1,level=330,departure=false)=>{
  const t={id:'TEST',callsign:'LOT123',aircraftType:'A320',lon,lat:0,heading:90,groundSpeed:450,actualFlightLevel:level,
    clearedFlightLevel:level,expectedCruiseLevel:380,plannedEntryLevel:380,exitFlightLevel:null,isDeparture:departure};
  setFlightPlan(t,[{name:'END',lon:8,lat:0}]);return t;
};
const state=(tracks=[])=>{
  const sectorisation=createSectorisation();
  return {air:{tracks,sectorisation,controlledSector:'ALLFIR',airspaceIndex:groupAirspace(rawIndex(),sectorisation)}};
};
const split=(s,ids)=>{
  const config=cloneSectorisation(s.air.sectorisation),id=addSectorGroup(config);
  moveSectorMembers(config,ids,id);config.controlledId=id;return config;
};

test('all named configurations match exact sets, including asymmetric E High naming',()=>{
  for(const [name,members] of Object.entries(SECTOR_PRESETS))assert.equal(sectorName([...members].reverse()),name);
  assert(SECTOR_PRESETS.NFIR.includes('E:HIGH'));
  assert(!SECTOR_PRESETS['NFIR H'].includes('E:HIGH'));
  assert(SECTOR_PRESETS['SFIR H'].includes('E:HIGH'));
  assert(!SECTOR_PRESETS.SFIR.includes('E:HIGH'));
  assert.equal(sectorName(['T:LOW','C:LOW','T:HIGH','C:HIGH']),'TC L+H');
  assert.equal(sectorName(['F:LOW','G:LOW','N:LOW','E:LOW']),'FGNE L');
  assert.equal(sectorName(['F:LOW','G:LOW','N:LOW','E:LOW','F:HIGH','G:HIGH','N:HIGH']),'FGNE L FGN H');
});

test('partitions cover every volume exactly once; moves, splits, releases and merges preserve coverage',()=>{
  const config=createSectorisation();assert(validateSectorisation(config));
  const group=addSectorGroup(config);moveSectorMembers(config,['T:LOW','C:LOW'],group);
  moveSectorMembers(config,['T:LOW'],null);
  assert.equal(config.groups.find(g=>g.members.includes('T:LOW')).members.length,1);
  assert(validateSectorisation(config));
  moveSectorMembers(config,ELEMENTARY_SECTORS,config.controlledId);
  assert.equal(config.groups.length,1);assert.equal(sectorName(config.groups[0].members),'ALLFIR');
  assert(validateSectorisation(config));
  const duplicate=cloneSectorisation(config);duplicate.groups[0].members.push('T:LOW');
  assert.throws(()=>validateSectorisation(duplicate),/exactly one/);
  const missing=cloneSectorisation(config);missing.groups[0].members.pop();
  assert.throws(()=>validateSectorisation(missing),/all 20/);
  config.controlledId='absent';assert.throws(()=>validateSectorisation(config),/Choose/);
});

test('supplied Low/High volumes all map; same group has no internal boundaries and FL365 changes layer',()=>{
  const read=path=>JSON.parse(fs.readFileSync(new URL('../'+path,import.meta.url)));
  const sectorIndex=createSectorIndex(['low','high'].map(layer=>read(`assets/geojson/epww_sectors_${layer}.geojson`)));
  assert.deepEqual(sectorIndex.sectors.map(v=>v.id).sort(),[...ELEMENTARY_SECTORS].sort());
  const config=createSectorisation(),high=addSectorGroup(config);moveSectorMembers(config,SECTOR_PRESETS['ALLFIR H'],high);
  const index=groupAirspace(rawIndex(),config),p={lon:1,lat:0};
  assert.equal(airspaceAt(index,p,364.999),'ALLFIR L');assert.equal(airspaceAt(index,p,365),'ALLFIR H');
  const s=state([track()]);updateTrafficControl(s);
  assert.deepEqual(s.air.tracks[0].trajectory.sequence.map(v=>v.sector),['ALLFIR','ESA']);
});

test('live split keeps in-area aircraft accepted and transfers outside aircraft immediately; all sequences refresh',()=>{
  const inside=track(1),outside=track(3),arrival=track(4,240);arrival.isArrival=true;
  const s=state([inside,outside,arrival]);updateTrafficControl(s);
  inside.clearedFlightLevel=350;inside.exitFlightLevel=360;
  const oldSequence=inside.trajectory;
  const config=cloneSectorisation(s.air.sectorisation),other=addSectorGroup(config);
  moveSectorMembers(config,ELEMENTARY_SECTORS.filter(id=>!['T:LOW','T:HIGH'].includes(id)),other);
  applySectorisation(s,config);
  assert.equal(s.air.controlledSector,'T L+H');assert.equal(inside.control.owner,'T L+H');assert.equal(inside.status,'accepted');
  assert.equal(inside.clearedFlightLevel,350);assert.equal(inside.exitFlightLevel,360);
  assert.notEqual(inside.trajectory,oldSequence);assert.equal(inside.trajectory.sequence[1].sector,sectorName(config.groups.find(g=>g.id===other).members));
  assert.equal(outside.control.owner,outside.control.physical);assert.notEqual(outside.control.owner,'T L+H');
  assert.equal(arrival.clearedFlightLevel,240,'reconfiguration does not introduce arrival descent');
  assert(extendedSectorSequence(inside)[1].text.includes('/'),'another domestic ACC group keeps its XFL');
  assert.equal(extendedSectorSequence(inside).at(-1).text,'ESA');
});

test('switching controlled sector restores its own XFL; stale proposals cancel and invalid drafts are atomic',()=>{
  const t=track(),s=state([t]);updateTrafficControl(s);t.exitFlightLevel=340;
  let config=split(s,['C:LOW','C:HIGH']);applySectorisation(s,config);
  assert.equal(t.exitFlightLevel,null);t.exitFlightLevel=370;
  issueInstruction(t,'speed',{mode:'ias',value:250});assert(t.control.pending.speed);
  config=cloneSectorisation(s.air.sectorisation);config.controlledId='acc-1';applySectorisation(s,config);
  assert.equal(t.exitFlightLevel,340);assert.deepEqual(t.control.pending,{});
  const index=s.air.airspaceIndex;const invalid=cloneSectorisation(config);invalid.groups[0].members=[];
  assert.throws(()=>applySectorisation(s,invalid));assert.equal(s.air.airspaceIndex,index);
  config.controlledId=config.groups.find(g=>g.id!=='acc-1').id;applySectorisation(s,config);assert.equal(t.exitFlightLevel,370);
});

test('a newly created controlled group preserves CFL and XFL for aircraft that stay under user control',()=>{
  const t=track(),s=state([t]);updateTrafficControl(s);t.clearedFlightLevel=350;t.exitFlightLevel=360;
  applySectorisation(s,split(s,['T:LOW','T:HIGH']));
  assert.equal(t.control.owner,'T L+H');assert.equal(t.status,'accepted');
  assert.equal(t.clearedFlightLevel,350);assert.equal(t.exitFlightLevel,360);
});

test('merging groups prefers destination XFL even when the destination is renamed',()=>{
  const t=track(7),s=state([t]);let config=split(s,['C:LOW','C:HIGH']);applySectorisation(s,config);
  t.exitFlightLevel=370;t.sectorExitLevels[sectorName(config.groups.find(g=>g.id==='acc-1').members)]=330;
  config=cloneSectorisation(s.air.sectorisation);config.controlledId='acc-1';
  moveSectorMembers(config,ELEMENTARY_SECTORS,'acc-1');applySectorisation(s,config);
  assert.equal(t.exitFlightLevel,330);
});

test('sectorised idle prediction is cached and refreshes immediately after XFL, ECL or configuration edits',()=>{
  const t=track(),s=state([t]);applySectorisation(s,split(s,['C:LOW','C:HIGH']));
  const first=t.trajectory;updateTrafficControl(s);assert.equal(t.trajectory,first);
  t.exitFlightLevel=350;updateTrafficControl(s);assert.notEqual(t.trajectory,first);
  const second=t.trajectory;t.expectedCruiseLevel=370;updateTrafficControl(s);assert.notEqual(t.trajectory,second);
});

test('computer departures follow ECL across remote groups; PEL restricts only the immediately preceding group',()=>{
  const t=track(.2,150,true),s=state([t]);
  const config=split(s,['J:LOW','J:HIGH']),c=addSectorGroup(config);moveSectorMembers(config,['C:LOW','C:HIGH'],c);
  applySectorisation(s,config);
  assert.equal(t.clearedFlightLevel,380);
  t.expectedCruiseLevel=360;updateTrafficControl(s);assert.equal(t.clearedFlightLevel,360);
  issueInstruction(t,'plannedEntryLevel',250);updateTrafficControl(s,3.1);
  assert.equal(t.sectorExitLevels['C L+H'],250);
  assert.equal(t.clearedFlightLevel,360,'upstream computer sector is not constrained by another sector’s XFL');
  assert.equal(t.trajectory.sequence.find(v=>v.sector==='C L+H').targetLevel,250);
  t.lon=2.2;updateTrafficControl(s);assert.equal(t.clearedFlightLevel,250);
  assert.equal(t.plannedEntryLevel,250);
  t.lon=4.2;updateTrafficControl(s);assert.equal(t.control.owner,'J L+H');
  assert.equal(t.clearedFlightLevel,250,'actual clearance stays under user control');
  assert.equal(t.trajectory.sequence[0].targetLevel,360,'unfilled user XFL predicts ECL');
});

test('a lower user XFL stops the virtual climb before a computer High sector resumes to ECL',()=>{
  const t=track(.1,200,true),s=state([t]);
  const config=cloneSectorisation(s.air.sectorisation),high=addSectorGroup(config);moveSectorMembers(config,SECTOR_PRESETS['ALLFIR H'],high);
  applySectorisation(s,config);t.exitFlightLevel=350;updateTrafficControl(s);
  assert(!t.trajectory.sequence.some(v=>v.sector==='ALLFIR H'));
  t.exitFlightLevel=370;updateTrafficControl(s);
  const visit=t.trajectory.sequence.find(v=>v.sector==='ALLFIR H');assert(visit);assert(Math.abs(visit.entry.level-365)<1e-5);assert.equal(visit.targetLevel,380);
  t.actualFlightLevel=366;updateTrafficControl(s);assert.equal(t.clearedFlightLevel,380);
});

test('shading uses the union of both layers, including High-only lateral areas',()=>{
  const s=state(),config=split(s,['T:LOW','C:LOW','T:HIGH','C:HIGH','J:HIGH']);applySectorisation(s,config);
  assert.equal(s.air.controlledSector,'TC L TCJ H');
  const polygons=controlledFootprint(s.air.airspaceIndex,s.air.controlledSector);
  assert.equal(polygons.length,5);assert(polygons.some(p=>p.bounds.minLon===4));
});
