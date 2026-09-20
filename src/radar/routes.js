// Navigation uses geographic points, independently of map visibility/projection.
const radians = degrees=>degrees * Math.PI / 180;
const normalize = degrees=>((degrees % 360) + 360) % 360;
export const pointName = value=>String(value ?? '').trim().toUpperCase();
export const validPoint = point=>!!pointName(point?.name) && Number.isFinite(point?.lon)
  && Math.abs(point.lon) <= 180 && Number.isFinite(point?.lat) && Math.abs(point.lat) <= 90;
const copyPoint = point=>({name:pointName(point.name),lon:point.lon,lat:point.lat});
const changed = track=>{ track.labelRevision = (track.labelRevision || 0) + 1; };

export function createNavigationIndex(collections){
  const index = new Map();
  const overrides = new Map();
  for(const collection of collections || []){
    for(const feature of collection?.features || []){
      if(feature.geometry?.type !== 'Point') continue;
      const [lon,lat] = feature.geometry.coordinates || [];
      const point = {name:pointName(feature.properties?.icao || feature.properties?.name),lon,lat};
      if(!validPoint(point)) continue;
      // Explicit simulator corrections take precedence regardless of load order.
      const target = collection.navigationOverrides === true ? overrides : index;
      const matches = target.get(point.name) || [];
      if(!matches.some(p=>p.lon === lon && p.lat === lat)) matches.push(point);
      target.set(point.name,matches);
    }
  }
  for(const [name,matches] of overrides) index.set(name,matches);
  return index;
}

export function remainingPlanPoints(track){
  const plan = track?.flightPlan;
  if(!Array.isArray(plan?.waypoints)) return [];
  const next = Number.isInteger(plan.nextIndex) ? Math.max(0,plan.nextIndex) : 0;
  return plan.waypoints.slice(next).map((point,i)=>({...point,index:next+i}));
}

export function setFlightPlan(track, waypoints, nextIndex=0){
  if(!Array.isArray(waypoints) || !waypoints.length || !waypoints.every(validPoint)
    || !Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex > waypoints.length){
    throw new Error('A flight plan needs resolved points and a valid next-point index.');
  }
  track.flightPlan = {waypoints:waypoints.map(copyPoint),nextIndex};
  track.directTo = null;
  track.navigationIntercept = null;
  track.navigationMode = 'route';
  track.assignedHeading = null;
  changed(track);
}

export function assignHeading(track, heading=null){
  track.directTo = null;
  track.navigationIntercept = null;
  track.navigationMode = 'heading';
  track.assignedHeading = Number.isFinite(heading) ? normalize(heading) : null;
  changed(track);
}

export function assignDirectTo(track, point, {planIndex=null,rejoinIndex=null}={}){
  if(!validPoint(point)) throw new Error('Choose a known point.');
  const remaining = remainingPlanPoints(track);
  // Typed points follow the same shortcut semantics as selecting an FPL row.
  if(planIndex == null && rejoinIndex == null){
    planIndex = remaining.find(p=>pointName(p.name) === pointName(point.name)
      && p.lon === point.lon && p.lat === point.lat)?.index ?? null;
  }
  const planned = remaining.find(p=>p.index === planIndex);
  const rejoin = remaining.find(p=>p.index === rejoinIndex);
  if(planIndex != null && (!planned || !validPoint(planned) || planned.lon !== point.lon || planned.lat !== point.lat
    || pointName(planned.name) !== pointName(point.name))) throw new Error('That point is no longer ahead on this flight plan.');
  if(rejoinIndex != null && (!rejoin || !validPoint(rejoin))) throw new Error('Choose a remaining flight-plan point to rejoin.');
  if(planIndex != null && rejoinIndex != null) throw new Error('A route shortcut already continues the flight plan.');
  if(planIndex != null) track.flightPlan.nextIndex=planIndex;
  track.directTo = {target:copyPoint(point),planIndex,rejoinIndex,plan:track.flightPlan || null};
  track.navigationIntercept = null;
  track.navigationMode = 'direct';
  track.assignedHeading = null;
  changed(track);
}

export function navigationTarget(track){
  if(track?.navigationMode === 'direct' && validPoint(track.directTo?.target)) return track.directTo.target;
  if(track?.navigationMode === 'route'){
    const point = remainingPlanPoints(track)[0];
    return validPoint(point) ? point : null;
  }
  return null;
}

export function bearingToPoint(track, point){
  const lat1=radians(track.lat), lat2=radians(point.lat), delta=radians(point.lon-track.lon);
  return normalize(Math.atan2(Math.sin(delta)*Math.cos(lat2),
    Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(delta)) * 180 / Math.PI);
}

export function navigationHeading(track, point){
  const bearing=bearingToPoint(track,point);
  const delta=((bearing-track.heading+540)%360)-180;
  const dLat=radians(point.lat-track.lat), dLon=radians(point.lon-track.lon);
  const hav=Math.sin(dLat/2)**2 + Math.cos(radians(track.lat))*Math.cos(radians(point.lat))*Math.sin(dLon/2)**2;
  const distance=3440.065*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,hav))));
  const radius=Math.max(0,track.groundSpeed || 0)/3600/radians(3);
  const key=`${point.name}:${point.lon}:${point.lat}`;
  if(track.navigationIntercept?.key !== key) track.navigationIntercept=null;
  // A fix inside the minimum turn circle cannot be reached by pure pursuit.
  // Extend on the current heading until there is room for a rate-one intercept.
  if(!track.navigationIntercept && distance < 2.2*radius && Math.abs(delta)>60){
    track.navigationIntercept={key,heading:track.heading};
  }
  if(track.navigationIntercept){
    if(distance < 3*radius) return track.navigationIntercept.heading;
    track.navigationIntercept=null;
  }
  return bearing;
}

// Test the travelled segment, not merely the end position: fast ticks must not
// jump over a fix. A 0.05 NM capture circle avoids orbiting numerical leftovers.
export function passedNavigationPoint(from, to, point){
  const scale = Math.cos(radians(point.lat));
  const deltaLon = lon=>((lon-point.lon+540)%360)-180;
  const a = {x:deltaLon(from.lon)*60*scale,y:(from.lat-point.lat)*60};
  const b = {x:deltaLon(to.lon)*60*scale,y:(to.lat-point.lat)*60};
  const dx=b.x-a.x, dy=b.y-a.y, length2=dx*dx+dy*dy;
  const t=length2 ? Math.max(0,Math.min(1,-(a.x*dx+a.y*dy)/length2)) : 0;
  return Math.hypot(a.x+t*dx,a.y+t*dy) <= 0.05;
}

export function completeNavigationPoint(track){
  track.navigationIntercept = null;
  const direct = track.directTo;
  if(track.navigationMode === 'direct'){
    track.directTo = null;
    // If the plan was replaced while rerouting, never apply an old index to it.
    if(direct?.plan && direct.plan === track.flightPlan && direct.planIndex != null){
      track.flightPlan.nextIndex = Math.max(track.flightPlan.nextIndex || 0,direct.planIndex+1);
      track.navigationMode = 'route';
    }else if(direct?.plan && direct.plan === track.flightPlan && direct.rejoinIndex != null
      && remainingPlanPoints(track).some(p=>p.index === direct.rejoinIndex)){
      track.flightPlan.nextIndex = direct.rejoinIndex;
      track.navigationMode = 'route';
    }else{
      track.navigationMode = 'heading';
    }
  }else if(track.navigationMode === 'route'){
    track.flightPlan.nextIndex = (track.flightPlan.nextIndex || 0) + 1;
  }
  if(track.navigationMode === 'route' && !navigationTarget(track)) track.navigationMode = 'heading';
  // Keep the arrival heading; an earlier heading clearance must not return.
  track.assignedHeading = null;
  changed(track);
}
