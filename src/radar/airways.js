import { pointName, validPoint, setFlightPlan } from './routes.js';

// Geometry expansion only. Direction checks do not validate flight levels/CDRs.
const speedLevel = /^(?:N\d{4}|K\d{4}|M\d{3})(?:F\d{3}|A\d{3}|S\d{4}|M\d{4})$/;
const copy = point => ({ name: point.name, lon: point.lon, lat: point.lat });

export function createAirwayResolver(dataset, navigationIndex = new Map()) {
  if (dataset?.schemaVersion !== 1 || !dataset.points || !dataset.airways) {
    throw new Error('Unsupported airway dataset.');
  }
  const points = new Map();
  for (const [name, value] of Object.entries(dataset.points)) {
    const point = { name, lon: value.lon, lat: value.lat };
    if (name !== pointName(name) || !validPoint(point)) throw new Error(`Invalid airway point: ${name}`);
    points.set(name, point);
  }
  const airways = new Map();
  for (const [name, airway] of Object.entries(dataset.airways)) {
    const sequence = airway.waypoints;
    if (!Array.isArray(sequence) || sequence.length < 2 || new Set(sequence).size !== sequence.length
      || sequence.some(id => !points.has(id)) || !Array.isArray(airway.legs)
      || airway.legs.length !== sequence.length - 1) throw new Error(`Invalid airway: ${name}`);
    const legs = airway.legs.map((leg, i) => {
      if (leg.from !== sequence[i] || leg.to !== sequence[i + 1]
        || !['published', 'external-gap'].includes(leg.status)
        || (leg.status === 'published' && (!Array.isArray(leg.directions) || !leg.directions.length
          || leg.directions.some(direction => !['forward', 'reverse'].includes(direction))))) {
        throw new Error(`Invalid leg in ${name}: ${sequence[i]}–${sequence[i + 1]}`);
      }
      return { ...leg, directions: [...(leg.directions || [])] };
    });
    airways.set(name, { waypoints: [...sequence], legs });
  }

  function fixToken(token) {
    const [name, suffix, extra] = token.split('/');
    if (extra !== undefined || (suffix !== undefined && !speedLevel.test(suffix))) {
      throw new Error(`Unsupported route token: ${token}`);
    }
    if (!/^[A-Z0-9]{2,7}$/.test(name) || name === 'DCT' || airways.has(name)) {
      throw new Error(`Expected a waypoint, received: ${token}`);
    }
    return name;
  }

  function resolvePoint(name) {
    // This publication supplies coordinates for every airway fix, including RSW.
    if (points.has(name)) return copy(points.get(name));
    const candidates = (navigationIndex.get(name) || []).filter(validPoint);
    const unique = candidates.filter((p, i) => !candidates.slice(0, i).some(q =>
      Math.abs(p.lon - q.lon) < 1e-7 && Math.abs(p.lat - q.lat) < 1e-7));
    if (unique.length === 0) throw new Error(`Unknown waypoint or unsupported airway: ${name}`);
    if (unique.length > 1) throw new Error(`Ambiguous waypoint: ${name}`);
    return { name, lon: unique[0].lon, lat: unique[0].lat };
  }

  function expandAirway(name, entry, exit, { respectDirection = false } = {}) {
    name = pointName(name); entry = pointName(entry); exit = pointName(exit);
    const airway = airways.get(name);
    if (!airway) throw new Error(`Unknown airway: ${name}`);
    const start = airway.waypoints.indexOf(entry), end = airway.waypoints.indexOf(exit);
    if (start < 0 || end < 0) throw new Error(`${entry} and ${exit} must both belong to ${name}.`);
    if (start === end) throw new Error(`Airway ${name} needs different entry and exit points.`);
    const step = end > start ? 1 : -1;
    for (let i = start; i !== end; i += step) {
      const leg = airway.legs[Math.min(i, i + step)];
      if (leg.status === 'external-gap') {
        throw new Error(`${name} has an uncovered segment ${leg.from}–${leg.to}; see ${leg.reference}.`);
      }
      const direction = step > 0 ? 'forward' : 'reverse';
      if (respectDirection && !leg.directions.includes(direction)) {
        throw new Error(`${name}: ${airway.waypoints[i]} to ${airway.waypoints[i + step]} opposes the published direction.`);
      }
    }
    const result = [];
    for (let i = start; ; i += step) {
      result.push(resolvePoint(airway.waypoints[i]));
      if (i === end) return result;
    }
  }

  function resolveRoute(text, options = {}) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Enter a route.');
    const tokens = text.trim().toUpperCase().split(/\s+/);
    if (speedLevel.test(tokens[0])) tokens.shift();
    if (!tokens.length) throw new Error('The route needs a waypoint.');
    const result = [resolvePoint(fixToken(tokens[0]))];
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === 'DCT') {
        if (i + 1 >= tokens.length) throw new Error('DCT needs an exit waypoint.');
        result.push(resolvePoint(fixToken(tokens[++i])));
      } else if (airways.has(token)) {
        if (i + 1 >= tokens.length) throw new Error(`${token} needs an exit waypoint.`);
        const exit = fixToken(tokens[++i]);
        result.push(...expandAirway(token, result.at(-1).name, exit, options).slice(1));
      } else {
        result.push(resolvePoint(fixToken(token)));
      }
    }
    return result;
  }

  return { resolveRoute, expandAirway, resolvePoint,
    getAirway(name) {
      const airway=airways.get(pointName(name));
      return airway ? {waypoints:[...airway.waypoints],legs:airway.legs.map(leg=>({...leg,directions:[...leg.directions]}))} : null;
    }
  };
}

// Resolve completely before touching the aircraft, so invalid routes are atomic.
export function setRouteFlightPlan(track, route, resolver, options = {}) {
  const waypoints = resolver.resolveRoute(route, options);
  setFlightPlan(track, waypoints);
  return waypoints;
}
