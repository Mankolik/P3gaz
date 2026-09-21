import { createTrack } from './tracks.js';
import { bearingToPoint } from './routes.js';
import { updateTrackSectors } from './sectors.js';
import { aircraftPerformance } from './performance.js';
import { convertIasToTas, convertMachToTas } from '../utils/speed.js';
import { requestedCruiseLevel } from './cruise-level.js';
import { updateTrafficControl } from './traffic-control.js';

const draw=random=>Math.max(0,Math.min(1-Number.EPSILON,random()));
const choose=(items,random)=>items[Math.floor(draw(random)*items.length)];

export function createAircraftSpawner(catalogue, {random=Math.random}={}) {
  if(!catalogue.groups.length) throw new Error('No routes are ready to spawn.');
  for(const group of catalogue.groups)for(const callsign of group.callsigns) {
    const types=group.aircraftTypesByOperator?.[callsign.slice(0,3)];
    if(!Array.isArray(types) || !types.length || types.some(type=>! /^[A-Z0-9]{2,4}$/.test(type)))
      throw new Error(`Missing or invalid aircraft pool for ${group.departure}-${group.destination} / ${callsign.slice(0,3)}.`);
    for(const type of types)if(!aircraftPerformance(type))throw new Error(`Missing aircraft performance for ${type}.`);
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
    const performance=aircraftPerformance(aircraftType);
    const heading=bearingToPoint(position,next);
    // One cruise draw supplies ECL and airborne spawn altitude. Departures
    // start at FL010; the computer sector subsequently issues their climb CFL.
    const cruiseLevel=requestedCruiseLevel(group,performance,random);
    let id;
    do {id=`spawn-${++sequence}`;} while(state.air.tracks.some(t=>t.id===id));
    const ground=variant.groundStart;
    const track=createTrack({id,callsign,status:'accepted',lon:position.lon,lat:position.lat,heading,
      groundSpeed:ground?convertIasToTas(180,1000):convertMachToTas(performance.cruise.mach,cruiseLevel*100),
      verticalSpeed:0,actualFlightLevel:ground?10:cruiseLevel,
      clearedFlightLevel:ground?10:cruiseLevel,plannedEntryLevel:cruiseLevel,exitFlightLevel:null,expectedCruiseLevel:cruiseLevel,
      aircraftType,wake:/^(B74|B77|B78|A33|A34|A35|A38)/.test(aircraftType)?'H':'M',
      destination:group.destination,flightPlan:{waypoints:variant.waypoints,nextIndex:variant.spawnIndex+1},
      // Airport departures start airborne, ready to follow their route.
      departure:group.departure,onGround:false,
    },state.map.project);
    track.sourceRoute={departure:group.departure,destination:group.destination,route:variant.route,
      sourceLine:variant.sourceLine,sourceFlightLevel:variant.sourceFlightLevel,annotations:variant.annotations,
      omittedPoints:variant.omittedPoints,operator,aircraftTypeSource:'route-operator-pool'};
    track.spawnPoint=position.name;
    track.isDeparture=ground;
    state.air.tracks.push(track);
    updateTrackSectors(state);
    updateTrafficControl(state);
    state.bus?.emit('track:spawned',track);
    return track;
  }
  return {spawn,catalogue};
}
