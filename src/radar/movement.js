function toRadians(deg){
  return (Number.isFinite(deg) ? deg : 0) * Math.PI / 180;
}

function normalizeHeading(heading){
  if(heading==null || Number.isNaN(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

function propagatePosition(lon, lat, headingDeg, distanceNm){
  const heading = normalizeHeading(headingDeg);
  const headingRad = heading * Math.PI / 180;
  const latRad = toRadians(lat);
  const deltaLatDeg = (distanceNm * Math.cos(headingRad)) / 60;
  const cosLat = Math.cos(latRad);
  const safeCos = Math.abs(cosLat) < 1e-6 ? (cosLat >= 0 ? 1e-6 : -1e-6) : cosLat;
  const deltaLonDeg = (distanceNm * Math.sin(headingRad)) / (60 * safeCos);
  return {
    lon: lon + deltaLonDeg,
    lat: lat + deltaLatDeg,
  };
}

function projectPosition(project, lon, lat, fallback){
  if(typeof project === 'function'){
    const projected = project(lon, lat);
    if(Array.isArray(projected) && projected.length >= 2){
      return { x: projected[0], y: projected[1] };
    }
  }
  return fallback || { x: 0, y: 0 };
}

export function updateTrackMovement(state, dt){
  if(!state || typeof state !== 'object') return;
  const tracks = state?.air?.tracks;
  if(!Array.isArray(tracks) || tracks.length === 0) return;
  const project = state?.map?.project;
  const seconds = Number.isFinite(dt) ? dt : 0;
  if(!(seconds > 0)){
    // Even if no time elapsed we still want to refresh vector projections.
    for(const track of tracks){
      updateTrackVector(track, project);
    }
    return;
  }

  for(const track of tracks){
    advanceTrack(track, seconds, project);
  }
}

function advanceTrack(track, dtSeconds, project){
  if(!track || typeof track !== 'object'){
    return;
  }
  if(!Number.isFinite(track.lon) || !Number.isFinite(track.lat)){
    track.vectorDx = 0;
    track.vectorDy = 0;
    return;
  }
  const speed = Number.isFinite(track.groundSpeed) ? Math.max(track.groundSpeed, 0) : 0;
  const heading = normalizeHeading(track.heading);
  const lon = track.lon;
  const lat = track.lat;

  const distanceNm = speed * dtSeconds / 3600;
  let nextLon = lon;
  let nextLat = lat;
  if(distanceNm > 0){
    const next = propagatePosition(lon, lat, heading, distanceNm);
    nextLon = next.lon;
    nextLat = next.lat;
  }

  track.lon = nextLon;
  track.lat = nextLat;

  const projected = projectPosition(project, nextLon, nextLat, { x: track.x ?? 0, y: track.y ?? 0 });
  track.x = projected.x;
  track.y = projected.y;

  updateTrackVector(track, project);
}

function updateTrackVector(track, project){
  if(!track || typeof track !== 'object') return;
  if(!Number.isFinite(track.lon) || !Number.isFinite(track.lat)){
    track.vectorDx = 0;
    track.vectorDy = 0;
    return;
  }
  const speed = Number.isFinite(track.groundSpeed) ? Math.max(track.groundSpeed, 0) : 0;
  const heading = normalizeHeading(track.heading);
  const lon = track.lon;
  const lat = track.lat;

  if(speed <= 0){
    track.vectorDx = 0;
    track.vectorDy = 0;
    return;
  }

  const minuteDistance = speed / 60;
  const future = propagatePosition(lon, lat, heading, minuteDistance);
  const futureProjected = projectPosition(project, future.lon, future.lat, { x: track.x ?? 0, y: track.y ?? 0 });
  track.vectorDx = futureProjected.x - (track.x ?? 0);
  track.vectorDy = futureProjected.y - (track.y ?? 0);
}

