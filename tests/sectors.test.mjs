import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSectorIndex, resolveTrackSectors, updateTrackSectors, sectorMembershipTitle, sectorLimitsText } from '../src/radar/sectors.js';
import { updateTrackMovement } from '../src/radar/movement.js';
import { createBus } from '../src/core/bus.js';

const square = (left=0, bottom=0, right=10, top=10)=>[[left,bottom],[right,bottom],[right,top],[left,top],[left,bottom]];
const sector = (code, min=95, max=365, coordinates=[square()], type='Polygon')=>({
  type:'Feature', properties:{ sector:code, vertical:min >= 365 ? 'HIGH' : 'LOW', name:`EPWW ${code}`, min_fl:min, max_fl:max },
  geometry:{type,coordinates},
});
const indexOf = (...features)=>createSectorIndex([{type:'FeatureCollection', features}]);
const at = (lon=5, lat=5, actualFlightLevel=200)=>({lon,lat,actualFlightLevel});
const ids = result=>result.sectors.map(sector=>sector.id);

test('membership requires both lateral containment and actual altitude', ()=>{
  const index = indexOf(sector('A'));
  assert.deepEqual(ids(resolveTrackSectors(index, at())), ['A:LOW']);
  assert.equal(resolveTrackSectors(index, at(11,5)).status, 'outside');
  assert.equal(resolveTrackSectors(index, at(5,11)).status, 'outside');
  assert.equal(resolveTrackSectors(index, {...at(5,5,90),clearedFlightLevel:200,plannedEntryLevel:200}).status, 'outside');
});

test('vertical bands use inclusive floors and exclusive ceilings', ()=>{
  const index = indexOf(sector('A'), sector('A',365,660));
  for(const [level, expected] of [[94.99,[]],[95,['A:LOW']],[364.999,['A:LOW']],[365,['A:HIGH']],[365.001,['A:HIGH']],[659.99,['A:HIGH']],[660,[]]]){
    assert.deepEqual(ids(resolveTrackSectors(index,at(5,5,level))), expected, `FL${level}`);
  }
});

test('polygon holes, winding direction and multipolygon islands are respected', ()=>{
  const index = indexOf(sector('A',95,365,[[square(),square(3,3,7,7).reverse()],[square(20,20,30,30)]],'MultiPolygon'));
  assert.deepEqual(ids(resolveTrackSectors(index,at(1,1))), ['A:LOW']);
  assert.equal(resolveTrackSectors(index,at(5,5)).status,'outside');
  assert.deepEqual(ids(resolveTrackSectors(index,at(3,5))), ['A:LOW']);
  assert.deepEqual(ids(resolveTrackSectors(index,at(25,25))), ['A:LOW']);
  assert.equal(resolveTrackSectors(index,at(15,15)).status,'outside');
  const open = square().slice(0,-1).reverse();
  assert.deepEqual(ids(resolveTrackSectors(indexOf(sector('B',95,365,[open])),at())), ['B:LOW']);
});

test('shared edges and overlaps report all matches in a stable order', ()=>{
  const index = indexOf(sector('B',95,365,[square(10,0,20,10)]),sector('A'));
  assert.deepEqual(ids(resolveTrackSectors(index,at(10,5))), ['A:LOW','B:LOW']);
  assert.deepEqual(ids(resolveTrackSectors(index,at(10,0))), ['A:LOW','B:LOW']);
  assert.deepEqual(ids(resolveTrackSectors(index,at(10.001,5))), ['B:LOW']);
  assert.deepEqual(ids(resolveTrackSectors(index,at(9.999,5))), ['A:LOW']);
  const overlapping = indexOf(sector('B'),sector('A'),sector('A'));
  assert.deepEqual(ids(resolveTrackSectors(overlapping,at())), ['A:LOW','B:LOW']);
});

test('missing position, altitude or complete data is unknown, never a guessed sector', ()=>{
  const index = indexOf(sector('A'));
  for(const track of [null,{},at(null,5),at(5,NaN),at(5,5,null),{...at(),actualFlightLevel:undefined,clearedFlightLevel:200}]){
    assert.equal(resolveTrackSectors(index,track).status,'unknown');
  }
  for(const broken of [null,createSectorIndex([]),createSectorIndex([{features:[sector('A')]}],{complete:false}),indexOf({...sector('B'),properties:{sector:'B'}})]){
    assert.equal(resolveTrackSectors(broken,at()).status,'unknown');
  }
});

test('movement and altitude changes refresh membership independently of map visibility', ()=>{
  const bus = createBus();
  const events = [];
  bus.on('track:sector-changed',event=>events.push(event));
  const track = {...at(0.99,0.5),groundSpeed:360,heading:90,clearedFlightLevel:200};
  const state = {bus,air:{tracks:[track],sectorIndex:indexOf(sector('A',95,365,[square(0,0,1,1)]),sector('B',95,365,[square(1,0,2,1)]),sector('B',365,660,[square(1,0,2,1)]))},map:{layers:new Map([['SECTOR_LOW',{visible:false}]])}};
  updateTrackSectors(state);
  assert.deepEqual(ids(track.sectorMembership), ['A:LOW']);
  const revision = track.labelRevision;
  updateTrackSectors(state);
  assert.equal(events.length,1);
  assert.equal(track.labelRevision,revision);
  updateTrackMovement(state,120);
  updateTrackSectors(state);
  assert.deepEqual(ids(track.sectorMembership), ['B:LOW']);
  track.actualFlightLevel=365;
  updateTrackSectors(state);
  assert.deepEqual(ids(track.sectorMembership), ['B:HIGH']);
  assert.equal(events.length,3);
  assert.deepEqual(ids(events[2].previous),['B:LOW']);
  track.actualFlightLevel=700;
  updateTrackSectors(state);
  assert.equal(track.sectorMembership.status,'outside');
  assert.deepEqual(track.sectorMembership.sectors,[]);
});

test('bundled EPWW data resolves known locations and the LOW/HIGH transition', async()=>{
  const datasets = await Promise.all(['low','high'].map(async band=>JSON.parse(await readFile(new URL(`../assets/geojson/epww_sectors_${band}.geojson`,import.meta.url),'utf8'))));
  const index = createSectorIndex(datasets);
  assert.equal(index.complete,true);
  assert.equal(index.sectors.length,20);
  for(const [lon,lat,code] of [[20.967,52.165,'E'],[18.466,54.377,'F'],[19.79,50.072,'J'],[16.83,52.4,'D']]){
    assert.deepEqual(ids(resolveTrackSectors(index,at(lon,lat,200))),[`${code}:LOW`]);
    assert.deepEqual(ids(resolveTrackSectors(index,at(lon,lat,365))),[`${code}:HIGH`]);
  }
  assert.equal(resolveTrackSectors(index,at(0,0)).status,'outside');
  assert.match(sectorMembershipTitle(resolveTrackSectors(index,at(20.967,52.165,380))),/EPWW E HIGH \(FL365–FL660\)/);
});

const fl = value=>({value,unit:'FL',ref:'STD'});
const ft = value=>({value,unit:'FT',ref:'AMSL'});
const tma = (code='A', floor=ft(12000), ceiling=fl(180), rings=[square(3,3,7,7)])=>({
  type:'Feature',properties:{icao:'TEST',tma_id:`TEST-${code}`,tma:code === 'UTMA' ? 'TEST UTMA' : 'TEST TMA',sector:code,vertical_bands:[{floor,ceiling}]},
  geometry:{type:'Polygon',coordinates:rings},
});

test('TMAs override ACC only inside both their lateral and vertical limits', ()=>{
  const index = indexOf(sector('A'),tma());
  for(const [level, kind] of [[119.99,'ACC'],[120,'TMA'],[179.99,'TMA'],[180,'ACC']]){
    const result = resolveTrackSectors(index,at(5,5,level));
    assert.equal(result.sectors.length,1);
    assert.equal(result.sectors[0].kind,kind);
  }
  assert.equal(resolveTrackSectors(index,at(2,5,140)).sectors[0].kind,'ACC');
  const match = resolveTrackSectors(index,at(5,5,140)).sectors[0];
  assert.equal(sectorLimitsText(match),'12000 FT AMSL–FL180');
  assert.equal(resolveTrackSectors(indexOf(sector('A'),tma('A',ft(2000),ft(8000))),at(5,5,40)).sectors[0].kind,'TMA');
});

test('local TMAs mask overlapping UTMAs, then return to UTMA and ACC above their ceilings', ()=>{
  const index = indexOf(sector('A'),tma('UTMA',fl(95),fl(285)),tma('A',ft(2000),fl(135)));
  assert.deepEqual(resolveTrackSectors(index,at(5,5,100)).sectors.map(s=>s.name),['TEST TMA A']);
  assert.deepEqual(resolveTrackSectors(index,at(5,5,135)).sectors.map(s=>s.name),['TEST UTMA']);
  assert.equal(resolveTrackSectors(index,at(5,5,285)).sectors[0].kind,'ACC');
});

test('separate TMA vertical bands preserve gaps and polygon holes', ()=>{
  const terminal = tma('A',fl(100),fl(130),[square(),square(3,3,7,7)]);
  terminal.properties.vertical_bands.push({floor:fl(160),ceiling:fl(180)});
  const index = indexOf(sector('A'),terminal);
  for(const [level,kind] of [[110,'TMA'],[130,'ACC'],[150,'ACC'],[160,'TMA'],[180,'ACC']]){
    assert.equal(resolveTrackSectors(index,at(1,1,level)).sectors[0].kind,kind);
  }
  assert.equal(resolveTrackSectors(index,at(5,5,110)).sectors[0].kind,'ACC');
});

test('unsupported TMA altitude references and incomplete datasets never silently fall back to ACC', ()=>{
  const terminal = tma('A',{value:1000,unit:'FT',ref:'AGL'},fl(135));
  assert.equal(resolveTrackSectors(indexOf(sector('A'),terminal),at()).status,'unknown');
  assert.equal(resolveTrackSectors(createSectorIndex([{features:[sector('A')]}],{complete:false}),at()).status,'unknown');
});

test('all bundled TMAs load and override ACC at Warsaw, Gdansk and Poznan', async()=>{
  const manifest = JSON.parse(await readFile(new URL('../assets/manifest.json',import.meta.url),'utf8'));
  const datasets = await Promise.all(manifest.geojson.filter(entry=>['SECTOR_LOW','SECTOR_HIGH','TMA'].includes(entry.layer)).map(async entry=>JSON.parse(await readFile(new URL('../'+entry.path,import.meta.url),'utf8'))));
  const index = createSectorIndex(datasets);
  assert.equal(index.complete,true);
  assert.equal(index.sectors.filter(s=>s.kind === 'TMA').length,62);
  for(const [lon,lat,level,name] of [
    [20.967,52.165,200,'EPWA TMA A'],[20.967,52.165,245,'EPWW E LOW'],
    [18.466,54.377,140,'EPGD UTMA'],[18.466,54.377,285,'EPWW F LOW'],
    [16.83,52.4,100,'EPPO TMA NORTH D'],[16.83,52.4,195,'EPWW D LOW'],
  ]) assert.deepEqual(resolveTrackSectors(index,at(lon,lat,level)).sectors.map(s=>s.name),[name]);
});
