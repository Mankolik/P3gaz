const radians=degrees=>degrees*Math.PI/180;
const valid=point=>Number.isFinite(point?.lat)&&Math.abs(point.lat)<=90
  && Number.isFinite(point?.lon)&&Math.abs(point.lon)<=180;

export function greatCircleDistanceKm(from,to) {
  if(!valid(from)||!valid(to))throw new Error('Airport coordinates are required for route distance.');
  const lat1=radians(from.lat),lat2=radians(to.lat);
  const a=Math.sin((lat2-lat1)/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(radians(to.lon-from.lon)/2)**2;
  return 6371.0088*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,a))));
}

export function generalTrackDegrees(from,to) {
  if(!valid(from)||!valid(to))throw new Error('Airport coordinates are required for general track.');
  const lat1=radians(from.lat),lat2=radians(to.lat),lonDelta=radians(to.lon-from.lon);
  return (Math.atan2(Math.sin(lonDelta)*Math.cos(lat2),
    Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(lonDelta))*180/Math.PI+360)%360;
}

// One cache per catalogue compilation. Variants and spawns only read the
// resulting group fields; route fixes/truncated foreign portions are irrelevant.
export function cacheRouteMetrics(groups,resolveAirport,{measureDistance=greatCircleDistanceKm}={}) {
  const cache=new Map();
  return groups.map(group=>{
    const key=`${group.departure}-${group.destination}`;
    if(!cache.has(key)) {
      const from=resolveAirport(group.departure),to=resolveAirport(group.destination);
      const routeDistanceKm=measureDistance(from,to);
      if(!Number.isFinite(routeDistanceKm)||routeDistanceKm<0)throw new Error(`Invalid route distance for ${key}.`);
      cache.set(key,{routeDistanceKm,generalTrack:generalTrackDegrees(from,to)});
    }
    return {...group,...cache.get(key)};
  });
}
