import { airspaceAt, airspaceLegCuts } from './airspace.js';
import { plannedRoutePoints as trajectoryRoute } from './planned-route.js';
export { trajectoryRoute };
import { aircraftCeiling, performanceSchedule } from './performance.js';
import { effectiveSpeedInstruction } from './speed-control.js';
import { calculateGroundSpeedFromInstruction } from '../utils/speed.js';
import { filterSectorSequence } from './sector-sequence.js';

export function distanceNm(a,b){
  const rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
  return 3440.065*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
const lerp=(a,b,t)=>({lon:a.lon+(b.lon-a.lon)*t,lat:a.lat+(b.lat-a.lat)*t});

export function sectorTargetLevel(track, sector, entryLevel, beforeControlled=true){
  const controlled=track.control?.sector || 'ALLFIR';
  let target=track.sectorExitLevels?.[sector];
  if(!track.control?.shared && sector===controlled)target=track.exitFlightLevel;
  else if(!track.control?.sectorised && beforeControlled && !Number.isFinite(target) && Number.isFinite(track.plannedEntryLevel))target=track.plannedEntryLevel;
  if(!Number.isFinite(target))target=track.isDeparture && Number.isFinite(track.expectedCruiseLevel)
    ? track.expectedCruiseLevel : entryLevel;
  return Math.max(0,Math.min(aircraftCeiling(track),target));
}

export function buildTrajectory(track,index){
  if(!index?.complete || !Number.isFinite(track.actualFlightLevel))return {points:[],sequence:[],complete:false};
  const route=trajectoryRoute(track),controlled=track.control?.sector || 'ALLFIR';
  let point={lon:track.lon,lat:track.lat,level:track.actualFlightLevel,distanceNm:0,timeSeconds:0};
  let sector=airspaceAt(index,point,point.level),before=sector!==controlled && !track.control?.hasEntered;
  const inherited=sector!==controlled ? track.control?.computerTargetLevel ?? point.level : point.level;
  let target=sectorTargetLevel(track,sector,inherited,before);
  const points=[point],sequence=[{sector,entry:point,targetLevel:target}];
  const levels=[...new Set([0,50,95,100,150,240,...index.volumes.flatMap(v=>[v.minFl,v.maxFl]),
    ...index.firs.flatMap(v=>[v.minFl,v.maxFl])])].sort((a,b)=>a-b);
  let iterations=0,complete=true;
  for(const end of route){
    const start=point,length=distanceNm(start,end);
    if(length<1e-6)continue;
    const cuts=airspaceLegCuts(index,start,end);
    let along=0,cutIndex=1;
    while(along<length-1e-7){
      if(++iterations>30000 || sequence.length>128){complete=false;break;}
      const direction=Math.sign(target-point.level);
      // Probe just inside the next horizontal/vertical volume at a boundary.
      const probe=lerp(start,end,Math.min(1,(along+1e-6)/length));
      const nextSector=airspaceAt(index,probe,point.level+direction*1e-7,sector);
      if(nextSector!==sector){
        sequence.at(-1).exit=point;
        sector=nextSector;
        if(sector===controlled)before=false;
        // Keep an unfinished coordinated climb/descent when the next sector
        // has no new target. Holding exactly on a TMA ceiling would bounce
        // between the two volumes instead of entering the receiving sector.
        target=sectorTargetLevel(track,sector,target,before);
        sequence.push({sector,entry:point,targetLevel:target});
      }
      const virtual={aircraftType:track.aircraftType,actualFlightLevel:point.level,clearedFlightLevel:target};
      const schedule=performanceSchedule(virtual);
      const instruction=effectiveSpeedInstruction(virtual,schedule);
      const speed=Math.max(60,calculateGroundSpeedFromInstruction(instruction,point.level*100,0,null) || track.groundSpeed || 400);
      const rate=Math.abs(target-point.level)>1e-6 ? Math.sign(target-point.level)*(schedule?.rateFpm || 1500) : 0;
      while(cutIndex<cuts.length-1 && cuts[cutIndex]*length<=along+1e-7)cutIndex++;
      // At a constant level, speed is constant too: integrate exactly to the
      // next geometry edge instead of rebuilding hundreds of identical samples.
      let seconds=Math.min(rate ? 10 : Infinity,(cuts[cutIndex]*length-along)*3600/speed);
      if(rate){
        const nextLevel=rate>0 ? levels.find(fl=>fl>point.level+1e-6) : [...levels].reverse().find(fl=>fl<point.level-1e-6);
        const limit=rate>0 ? Math.min(target,nextLevel ?? target) : Math.max(target,nextLevel ?? target);
        seconds=Math.min(seconds,Math.abs(limit-point.level)*6000/Math.abs(rate));
      }
      seconds=Math.max(seconds,1e-5);
      const moved=Math.min(length-along,speed*seconds/3600);
      along+=moved;
      const level=point.level+rate*seconds/6000;
      point={...lerp(start,end,along/length),level:Math.abs(level-target)<1e-6 ? target : level,
        distanceNm:point.distanceNm+moved,timeSeconds:point.timeSeconds+seconds};
      points.push(point);
    }
    if(!complete)break;
  }
  sequence.at(-1).end=point;
  return {points,...filterSectorSequence(sequence,track.control),complete,
    reason:complete?null:'Prediction limit reached; check route and coordinated levels'};
}
