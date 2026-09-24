import { TERMINAL_PROCEDURES } from '../data/terminal-procedures.js';

const index=new Map(TERMINAL_PROCEDURES.map(p=>[`${p.airport}:${p.type}:${p.connection}`,p]));
export const findTerminalProcedure=(airport,type,connection)=>index.get(`${airport}:${type}:${connection}`) || null;

export function procedureRoutePoints(procedure){
  return procedure.points.map(p=>({name:p.name,lon:p.lon,lat:p.lat,procedure:{
    airport:procedure.airport,type:procedure.type,name:procedure.name,runway:procedure.runway,
    altitude:{...p.altitude},speed:{...p.speed},altitudeText:p.altitudeText,speedText:p.speedText,
  }}));
}

// Supplement missing terminal fixes only. Never override en-route corrections
// or turn rounded coordinates from different AIP tables into ambiguous fixes.
export function addTerminalNavigation(index){
  for(const procedure of TERMINAL_PROCEDURES)for(const {name,lon,lat} of procedure.points){
    if(!index.has(name))index.set(name,[{name,lon,lat}]);
  }
  return index;
}
