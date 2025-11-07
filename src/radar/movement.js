import { calculateGroundSpeedFromInstruction } from '../utils/speed.js';

const RATE_ONE_DEG_PER_SECOND = 3; // degrees per second
const DEFAULT_SPEED_CHANGE_RATE = 5; // knots per second
const ZERO_WIND = { speed: 0, direction: 0 };

const FEET_PER_FLIGHT_LEVEL = 100;
const SECONDS_PER_MINUTE = 60;
const FLIGHT_LEVEL_TOLERANCE = 0.05;
const MAX_VERTICAL_RATE_FPM = 4000;
const DEFAULT_VERTICAL_RATE_FPM = 1500;
const VERTICAL_RATE_CHANGE_PER_SECOND = 1500;
const MIN_FLIGHT_LEVEL = 0;
const MAX_FLIGHT_LEVEL = 600;

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

  updateVerticalState(track, dtSeconds);

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

function clamp(value, min, max){
  if(!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function normalizeVerticalAssignment(raw){
  if(!raw || typeof raw !== 'object') return null;
  const value = Number(raw.value);
  if(!Number.isFinite(value)) return null;
  const comparator = raw.comparator === 'or-greater'
    ? 'or-greater'
    : raw.comparator === 'or-less'
      ? 'or-less'
      : 'exact';
  const clamped = clamp(Math.round(value), -MAX_VERTICAL_RATE_FPM, MAX_VERTICAL_RATE_FPM);
  return { value: clamped, comparator };
}

function determineTargetFlightLevel(track){
  if(!track || typeof track !== 'object') return null;
  if(Number.isFinite(track.clearedFlightLevel)){
    return track.clearedFlightLevel;
  }
  if(Number.isFinite(track.actualFlightLevel)){
    return track.actualFlightLevel;
  }
  if(Number.isFinite(track.plannedEntryLevel)){
    return track.plannedEntryLevel;
  }
  if(Number.isFinite(track.exitFlightLevel)){
    return track.exitFlightLevel;
  }
  return null;
}

function updateVerticalState(track, dtSeconds){
  if(!Number.isFinite(dtSeconds) || dtSeconds <= 0){
    return;
  }

  let currentLevel = Number(track.actualFlightLevel);
  if(!Number.isFinite(currentLevel)){
    const fallback = determineTargetFlightLevel(track);
    if(fallback!=null){
      track.actualFlightLevel = clamp(fallback, MIN_FLIGHT_LEVEL, MAX_FLIGHT_LEVEL);
    }
    track.verticalSpeed = 0;
    return;
  }

  const targetLevel = determineTargetFlightLevel(track);
  if(targetLevel==null){
    const currentRate = Number(track.verticalSpeed) || 0;
    const rateDelta = VERTICAL_RATE_CHANGE_PER_SECOND * dtSeconds;
    track.verticalSpeed = approachValue(currentRate, 0, rateDelta);
    return;
  }

  const diff = targetLevel - currentLevel;
  if(Math.abs(diff) <= FLIGHT_LEVEL_TOLERANCE){
    track.actualFlightLevel = clamp(targetLevel, MIN_FLIGHT_LEVEL, MAX_FLIGHT_LEVEL);
    track.verticalSpeed = 0;
    return;
  }

  const assignment = track.verticalRateAssigned ? normalizeVerticalAssignment(track.assignedVertical) : null;
  const direction = diff > 0 ? 1 : -1;
  let desiredRate = 0;
  if(assignment){
    const magnitude = Math.abs(assignment.value);
    if(magnitude === 0){
      desiredRate = 0;
    }else if(assignment.comparator === 'or-greater'){
      desiredRate = direction * Math.max(magnitude, Math.abs(Number(track.verticalSpeed) || 0));
    }else if(assignment.comparator === 'or-less'){
      desiredRate = direction * Math.min(magnitude, Math.abs(Number(track.verticalSpeed) || magnitude));
    }else{
      desiredRate = direction * magnitude;
    }
  }else{
    desiredRate = direction * computeDefaultVerticalRate(Math.abs(diff));
  }

  const currentRate = Number(track.verticalSpeed) || 0;
  const maxChange = VERTICAL_RATE_CHANGE_PER_SECOND * dtSeconds;
  const nextRate = approachValue(currentRate, desiredRate, maxChange);
  const clampedRate = clamp(nextRate, -MAX_VERTICAL_RATE_FPM, MAX_VERTICAL_RATE_FPM);
  track.verticalSpeed = Math.abs(clampedRate) < 1 ? 0 : clampedRate;

  const deltaFlightLevel = (track.verticalSpeed * dtSeconds) / (SECONDS_PER_MINUTE * FEET_PER_FLIGHT_LEVEL);
  let nextLevel = currentLevel + deltaFlightLevel;
  if((direction > 0 && nextLevel >= targetLevel) || (direction < 0 && nextLevel <= targetLevel)){
    nextLevel = targetLevel;
    track.verticalSpeed = 0;
  }
  track.actualFlightLevel = clamp(nextLevel, MIN_FLIGHT_LEVEL, MAX_FLIGHT_LEVEL);
}

function computeDefaultVerticalRate(diffFlightLevel){
  if(!Number.isFinite(diffFlightLevel) || diffFlightLevel <= 0){
    return 0;
  }
  const baseRate = Math.max(DEFAULT_VERTICAL_RATE_FPM, diffFlightLevel * FEET_PER_FLIGHT_LEVEL * 2);
  return clamp(baseRate, 0, MAX_VERTICAL_RATE_FPM);
}

function approachValue(current, target, maxDelta){
  if(!Number.isFinite(current)) current = 0;
  if(!Number.isFinite(target)) return current;
  if(!Number.isFinite(maxDelta) || maxDelta <= 0){
    return target;
  }
  const diff = target - current;
  if(Math.abs(diff) <= maxDelta){
    return target;
  }
  return current + Math.sign(diff) * maxDelta;
}

