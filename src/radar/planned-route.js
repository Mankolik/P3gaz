import { remainingPlanPoints, validPoint } from './routes.js';

// The drawn route and sector prediction share one path. Heading instructions
// only steer the aircraft; they do not invent a route or an assumed rejoin.
export function plannedRoutePoints(track){
  const remaining=remainingPlanPoints(track);
  let points=remaining;
  if(track?.navigationMode==='direct'){
    const direct=track.directTo;
    if(!validPoint(direct?.target))return [];
    points=[direct.target];
    if(direct.plan && direct.plan===track.flightPlan){
      if(Number.isInteger(direct.planIndex))points.push(...remaining.filter(p=>p.index>direct.planIndex));
      else if(Number.isInteger(direct.rejoinIndex))points.push(...remaining.filter(p=>p.index>=direct.rejoinIndex));
    }
  }
  // Neither view may jump across corrupt/missing route geometry.
  const invalid=points.findIndex(point=>!validPoint(point));
  return invalid<0 ? points : points.slice(0,invalid);
}
