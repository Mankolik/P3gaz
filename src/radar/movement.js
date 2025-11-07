import { calculateGroundSpeedFromInstruction } from '../utils/speed.js';

const RATE_ONE_DEG_PER_SECOND = 3; // degrees per second
const DEFAULT_SPEED_CHANGE_RATE = 5; // knots per second
const ZERO_WIND = { speed: 0, direction: 0 };

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
  const heading = normalizeHeading(track.heading);
  const nextHeading = updateHeading(track, heading, dtSeconds);
  track.heading = nextHeading;

  const speed = updateGroundSpeed(track, dtSeconds, nextHeading);
  const lon = track.lon;
  const lat = track.lat;

  const distanceNm = speed * dtSeconds / 3600;
  let nextLon = lon;
  let nextLat = lat;
  if(distanceNm > 0){
    const next = propagatePosition(lon, lat, nextHeading, distanceNm);
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

function updateHeading(track, currentHeading, dtSeconds){
  if(!Number.isFinite(dtSeconds) || dtSeconds <= 0){
    return currentHeading;
  }
  const target = Number.isFinite(track?.assignedHeading) ? normalizeHeading(track.assignedHeading) : null;
  if(target==null){
    return currentHeading;
  }
  const delta = shortestHeadingDelta(currentHeading, target);
  if(delta === 0){
    return target;
  }
  const maxChange = RATE_ONE_DEG_PER_SECOND * dtSeconds;
  if(Math.abs(delta) <= maxChange){
    return target;
  }
  return normalizeHeading(currentHeading + Math.sign(delta) * maxChange);
}

function shortestHeadingDelta(current, target){
  const normCurrent = normalizeHeading(current);
  const normTarget = normalizeHeading(target);
  let delta = normTarget - normCurrent;
  delta = ((delta + 540) % 360) - 180;
  return delta;
}

function updateGroundSpeed(track, dtSeconds, heading){
  const currentSpeed = Number.isFinite(track?.groundSpeed) ? Math.max(track.groundSpeed, 0) : 0;
  const assigned = track?.assignedSpeed;
  const target = calculateTargetGroundSpeed(track, assigned, heading);
  if(target==null || !Number.isFinite(target)){
    return currentSpeed;
  }
  if(!Number.isFinite(dtSeconds) || dtSeconds <= 0){
    const clamped = Math.max(0, target);
    track.groundSpeed = clamped;
    return clamped;
  }
  const rate = Number.isFinite(track?.speedChangeRate) ? Math.max(track.speedChangeRate, 0) : DEFAULT_SPEED_CHANGE_RATE;
  const maxDelta = rate * dtSeconds;
  const diff = target - currentSpeed;
  if(Math.abs(diff) <= maxDelta){
    track.groundSpeed = Math.max(0, target);
    return track.groundSpeed;
  }
  const next = currentSpeed + Math.sign(diff) * maxDelta;
  track.groundSpeed = Math.max(0, next);
  return track.groundSpeed;
}

function calculateTargetGroundSpeed(track, assigned, heading){
  if(!assigned || assigned.value==null || Number.isNaN(assigned.value)){
    return null;
  }
  const altitudeSource = Number.isFinite(track?.actualFlightLevel)
    ? track.actualFlightLevel
    : Number.isFinite(track?.clearedFlightLevel)
      ? track.clearedFlightLevel
      : Number.isFinite(track?.plannedEntryLevel)
        ? track.plannedEntryLevel
        : Number.isFinite(track?.exitFlightLevel)
          ? track.exitFlightLevel
          : 0;
  const altitudeFt = Number.isFinite(altitudeSource) ? altitudeSource * 100 : 0;
  const wind = track?.wind || ZERO_WIND;
  return calculateGroundSpeedFromInstruction(assigned, altitudeFt, heading, wind);
}

