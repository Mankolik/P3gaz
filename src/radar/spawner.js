import { createTrack } from './tracks.js';
import { bearingToPoint } from './routes.js';
import { updateTrackSectors } from './sectors.js';

// Supplied pools, with the subsequently discussed FL430/FL450 correction.
export const FLIGHT_LEVELS={east:[290,310,330,350,370,390,410,450],west:[280,300,320,340,360,380,400,430]};
const draw=random=>Math.max(0,Math.min(1-Number.EPSILON,random()));
const choose=(items,random)=>items[Math.floor(draw(random)*items.length)];

export function flightLevelWeights(heading) {
  const east=((heading%360)+360)%360<180,peak=east?350:340;
  return FLIGHT_LEVELS[east?'east':'west'].map(level=>({level,weight:level===peak?2:Math.abs(level-peak)===20?1.5:1}));
}
export function selectFlightLevel(heading, random=Math.random) {
  const choices=flightLevelWeights(heading);
  let roll=draw(random)*choices.reduce((n,item)=>n+item.weight,0);
  for(const item of choices) {roll-=item.weight;if(roll<0)return item.level;}
  return choices.at(-1).level;
}

export function createAircraftSpawner(catalogue, {random=Math.random}={}) {
  if(!catalogue.groups.length) throw new Error('No routes are ready to spawn.');
  for(const group of catalogue.groups)for(const callsign of group.callsigns) {
    const types=group.aircraftTypesByOperator?.[callsign.slice(0,3)];
    if(!Array.isArray(types) || !types.length || types.some(type=>! /^[A-Z0-9]{2,4}$/.test(type)))
      throw new Error(`Missing or invalid aircraft pool for ${group.departure}-${group.destination} / ${callsign.slice(0,3)}.`);
  }
  let sequence=0;
  function spawn(state) {
    const active=new Set(state.air.tracks.map(t=>t.callsign));
    const available=catalogue.groups.map(g=>({...g,callsigns:g.callsigns.filter(c=>!active.has(c))})).filter(g=>g.callsigns.length);
    if(!available.length) throw new Error('All catalogue callsigns are already in use.');
    // Keep the airport-pair, callsign, route draws independent and in that order.
    const group=choose(available,random),callsign=choose(group.callsigns,random),variant=choose(group.variants,random);
    const operator=callsign.slice(0,3),aircraftType=choose(group.aircraftTypesByOperator[operator],random);
    const position=variant.waypoints[variant.spawnIndex],next=variant.waypoints[variant.spawnIndex+1];
    const heading=bearingToPoint(position,next),level=selectFlightLevel(heading,random);
    let id;
    do {id=`spawn-${++sequence}`;} while(state.air.tracks.some(t=>t.id===id));
    const ground=variant.groundStart;
    const track=createTrack({id,callsign,status:'accepted',lon:position.lon,lat:position.lat,heading,
      groundSpeed:ground?180:450,verticalSpeed:0,actualFlightLevel:ground?10:level,
      clearedFlightLevel:ground?10:level,plannedEntryLevel:level,exitFlightLevel:level,expectedCruiseLevel:level,
      aircraftType,wake:/^(B74|B77|B78|A33|A34|A35|A38)/.test(aircraftType)?'H':'M',
      destination:group.destination,flightPlan:{waypoints:variant.waypoints,nextIndex:variant.spawnIndex+1},
      // Airport departures start airborne, ready to follow their route.
      departure:group.departure,onGround:false,
    },state.map.project);
    track.sourceRoute={departure:group.departure,destination:group.destination,route:variant.route,
      sourceLine:variant.sourceLine,sourceFlightLevel:variant.sourceFlightLevel,annotations:variant.annotations,
      omittedPoints:variant.omittedPoints,operator,aircraftTypeSource:'route-operator-pool'};
    track.spawnPoint=position.name;
    state.air.tracks.push(track);
    updateTrackSectors(state);
    state.bus?.emit('track:spawned',track);
    return track;
  }
  return {spawn,catalogue};
}
