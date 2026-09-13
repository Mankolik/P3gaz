// Membership uses source lon/lat polygons, independently of map visibility.
// Vertical bands include their floor and exclude their ceiling.
const EDGE_EPSILON = 1e-9;

function compilePolygon(rings){
  if(!Array.isArray(rings) || !rings.length) return null;
  const bounds = { minLon:Infinity, maxLon:-Infinity, minLat:Infinity, maxLat:-Infinity };
  for(const ring of rings){
    if(!Array.isArray(ring) || ring.length < 3) return null;
    for(const point of ring){
      if(!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
      bounds.minLon = Math.min(bounds.minLon, point[0]);
      bounds.maxLon = Math.max(bounds.maxLon, point[0]);
      bounds.minLat = Math.min(bounds.minLat, point[1]);
      bounds.maxLat = Math.max(bounds.maxLat, point[1]);
    }
  }
  return { rings, bounds };
}

export function createSectorIndex(collections, { complete = true } = {}){
  const sectors = [];
  for(const collection of collections || []){
    if(!Array.isArray(collection?.features) || !collection.features.length){
      complete = false;
      continue;
    }
    for(const feature of collection.features){
      const props = feature?.properties;
      const geometry = feature?.geometry;
      const coordinates = geometry?.type === 'Polygon' ? [geometry.coordinates]
        : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
      const polygons = Array.isArray(coordinates) ? coordinates.map(compilePolygon) : [];
      if(!props?.sector || !props?.vertical || !Number.isFinite(props.min_fl)
        || !Number.isFinite(props.max_fl) || props.max_fl <= props.min_fl
        || !polygons.length || polygons.some(polygon=>!polygon)){
        complete = false;
        continue;
      }
      const code = String(props.sector);
      const vertical = String(props.vertical);
      sectors.push({
        id:`${code}:${vertical}`, code, vertical,
        name:props.name || `${code} ${vertical}`,
        minFl:props.min_fl, maxFl:props.max_fl, polygons,
      });
    }
  }
  sectors.sort((a,b)=>a.id.localeCompare(b.id));
  return { sectors, complete:complete && sectors.length > 0 };
}

// 0 = outside, 1 = inside, 2 = on a boundary. Handles open or closed rings.
function classifyRing(lon, lat, ring){
  let inside = false;
  for(let i=0, j=ring.length-1; i<ring.length; j=i++){
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    const dx = bx-ax;
    const dy = by-ay;
    const length = Math.hypot(dx, dy);
    if(length > 0 && Math.abs(dx*(lat-ay) - dy*(lon-ax)) <= EDGE_EPSILON*length
      && lon >= Math.min(ax,bx)-EDGE_EPSILON && lon <= Math.max(ax,bx)+EDGE_EPSILON
      && lat >= Math.min(ay,by)-EDGE_EPSILON && lat <= Math.max(ay,by)+EDGE_EPSILON){
      return 2;
    }
    if((ay > lat) !== (by > lat) && lon < ax + (lat-ay)*dx/dy){
      inside = !inside;
    }
  }
  return inside ? 1 : 0;
}

function containsPoint(polygon, lon, lat){
  const { bounds, rings } = polygon;
  if(lon < bounds.minLon-EDGE_EPSILON || lon > bounds.maxLon+EDGE_EPSILON
    || lat < bounds.minLat-EDGE_EPSILON || lat > bounds.maxLat+EDGE_EPSILON) return false;
  if(classifyRing(lon, lat, rings[0]) === 0) return false;
  // The interior of a hole is excluded; its edge remains a shared boundary.
  return !rings.slice(1).some(ring=>classifyRing(lon, lat, ring) === 1);
}

export function resolveTrackSectors(index, track){
  if(!index?.complete || !Number.isFinite(track?.lon) || !Number.isFinite(track?.lat)
    || !Number.isFinite(track?.actualFlightLevel)){
    return { status:'unknown', sectors:[] };
  }
  const matches = new Map();
  for(const sector of index.sectors){
    if(track.actualFlightLevel < sector.minFl || track.actualFlightLevel >= sector.maxFl) continue;
    if(!sector.polygons.some(polygon=>containsPoint(polygon, track.lon, track.lat))) continue;
    const { polygons, ...membership } = sector;
    matches.set(sector.id, membership);
  }
  const sectors = [...matches.values()];
  return { status:sectors.length ? 'inside' : 'outside', sectors };
}

export function updateTrackSectors(state){
  for(const track of state?.air?.tracks || []){
    if(!track) continue;
    const next = resolveTrackSectors(state?.air?.sectorIndex, track);
    const previous = track.sectorMembership;
    if(previous?.status === next.status && JSON.stringify(previous.sectors) === JSON.stringify(next.sectors)) continue;
    track.sectorMembership = next;
    track.labelRevision = (track.labelRevision || 0) + 1;
    state.bus?.emit?.('track:sector-changed', { track, previous:previous || null, current:next });
  }
}

export function sectorMembershipTitle(membership){
  if(!membership || membership.status === 'unknown') return 'Sector: unavailable';
  if(membership.status === 'outside') return 'Sector: outside loaded sector limits';
  const names = membership.sectors.map(sector=>`${sector.name} (FL${String(sector.minFl).padStart(3,'0')}–${sector.maxFl})`);
  return `${names.length > 1 ? 'Sectors (boundary/overlap)' : 'Sector'}: ${names.join(' | ')}`;
}
