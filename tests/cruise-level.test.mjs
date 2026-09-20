import test from 'node:test';
import assert from 'node:assert/strict';
import {greatCircleDistanceKm,generalTrackDegrees,cacheRouteMetrics} from '../src/radar/route-metrics.js';
import {CRUISE_FLIGHT_LEVELS,cruiseLevelRange,cruiseLevelTarget,snapCruiseLevel,requestedCruiseLevel} from '../src/radar/cruise-level.js';

test('great-circle airport distance handles identical points, dateline and antipodes',()=>{
  const p=(lat,lon)=>({lat,lon});
  assert.equal(greatCircleDistanceKm(p(0,0),p(0,0)),0);
  assert(Math.abs(greatCircleDistanceKm(p(0,0),p(0,1))-111.19508)<0.001);
  assert(Math.abs(greatCircleDistanceKm(p(0,179),p(0,-179))-222.39016)<0.001);
  assert(Math.abs(greatCircleDistanceKm(p(0,0),p(0,180))-20015.11444)<0.001);
  assert.equal(generalTrackDegrees(p(0,0),p(0,1)),90);
  assert.equal(generalTrackDegrees(p(0,1),p(0,0)),270);
  assert.throws(()=>greatCircleDistanceKm(p(91,0),p(0,0)),/coordinates/);
});

test('airport-pair geometry is measured once even when duplicate groups have different variants',()=>{
  let calculations=0,resolutions=0;
  const group={departure:'AAAA',destination:'BBBB',variants:[{route:'detour'}]};
  const groups=cacheRouteMetrics([group,{...group,variants:[{route:'short'}]}],name=>{
    resolutions++;return {lat:0,lon:name==='AAAA'?0:1};
  },{measureDistance:(a,b)=>{calculations++;return greatCircleDistanceKm(a,b);}});
  assert.equal(calculations,1);assert.equal(resolutions,2);
  assert.equal(groups[0].routeDistanceKm,groups[1].routeDistanceKm);
  assert.equal(groups[0].generalTrack,90);assert.equal(group.routeDistanceKm,undefined);
  for(let i=0;i<100;i++)requestedCruiseLevel(groups[i%2],null,()=>0.5);
  assert.equal(calculations,1);assert.equal(resolutions,2);
});

test('distance bands use lower-inclusive boundaries and include exactly 3500 in the 340-400 band',()=>{
  for(const [distance,range] of [[0,[180,240]],[249.999,[180,240]],[250,[220,280]],[449.999,[220,280]],
    [450,[260,320]],[699.999,[260,320]],[700,[280,340]],[999.999,[280,340]],[1000,[300,360]],
    [1499.999,[300,360]],[1500,[320,380]],[2199.999,[320,380]],[2200,[340,400]],
    [3500,[340,400]],[3500.001,[350,410]],[20000,[350,410]]]){
    assert.deepEqual(cruiseLevelRange(distance),range,String(distance));
    assert.equal(cruiseLevelTarget(distance,()=>0.5),(range[0]+range[1])/2);
  }
  for(const bad of [-1,NaN,Infinity,undefined])assert.throws(()=>cruiseLevelRange(bad));
});

test('snapping uses the supplied extended east/west pools, wrapped tracks and lower ties',()=>{
  assert.deepEqual(CRUISE_FLIGHT_LEVELS.east,[190,210,230,250,270,290,310,330,350,370,390,410,450]);
  assert.deepEqual(CRUISE_FLIGHT_LEVELS.west,[180,200,220,240,260,280,300,320,340,360,380,400,430]);
  for(const heading of [0,179.999,360,720])assert.equal(snapCruiseLevel(224,heading),230);
  for(const heading of [180,359.999,-1])assert.equal(snapCruiseLevel(224,heading),220);
  assert.equal(snapCruiseLevel(220,90),210);
  assert.equal(snapCruiseLevel(210,270),200);
  assert.equal(snapCruiseLevel(449,90),450);
  assert.equal(snapCruiseLevel(449,270),430);
});

test('random targets stay near band midpoint and snapped levels remain in the distance band',()=>{
  for(const distance of [100,300,500,800,1200,1700,2500,5000]){
    const [min,max]=cruiseLevelRange(distance),mid=(min+max)/2;
    for(let i=0;i<=1000;i++){
      const target=cruiseLevelTarget(distance,()=>i/1000);
      assert(target>=mid-20&&target<=mid+20);
      for(const heading of [90,270]){
        const level=requestedCruiseLevel({routeDistanceKm:distance,generalTrack:heading},null,()=>i/1000);
        assert(level>=min&&level<=max);
        assert(Math.abs(level-target)<=10);
      }
    }
    assert.equal(cruiseLevelTarget(distance,()=>-10),mid-20);
    assert.equal(cruiseLevelTarget(distance,()=>10),mid+20);
    for(const heading of [90,270]){
      const levels=new Set([0.1,0.3,0.5,0.7,0.9].map(roll=>requestedCruiseLevel({routeDistanceKm:distance,generalTrack:heading},null,()=>roll)));
      assert(levels.size>1,'randomness must survive snapping in both directions');
    }
  }
  assert.notEqual(requestedCruiseLevel({routeDistanceKm:100,generalTrack:90},null,()=>0),
    requestedCruiseLevel({routeDistanceKm:100,generalTrack:90},null,()=>1));
});

test('ceiling and optional usable cruise cap preserve directional validity, including below the band',()=>{
  assert.equal(snapCruiseLevel(400,90,{ceilingFL:380}),370);
  assert.equal(snapCruiseLevel(400,270,{ceilingFL:390}),380);
  assert.equal(snapCruiseLevel(400,90,{ceilingFL:410,maxCruiseFL:350}),350);
  assert.equal(snapCruiseLevel(400,270,{ceilingFL:410,maxCruiseFL:350}),340);
  assert.equal(requestedCruiseLevel({routeDistanceKm:5000,generalTrack:90},{ceilingFL:250},()=>0.9),250);
  assert.equal(snapCruiseLevel(400,270),400);
  assert.throws(()=>snapCruiseLevel(400,90,{ceilingFL:180}),/No directional/);
});
