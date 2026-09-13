// Membership uses source lon/lat polygons, independently of map visibility.
// Vertical bands include their floor and exclude their ceiling.
const EDGE_EPSILON = 1e-9;

function altitudeToFl(altitude){
  if(!Number.isFinite(altitude?.value)) return null;
  if(altitude.unit === 'FL' && altitude.ref === 'STD') return altitude.value;
  // The simulator has no QNH model. Use its existing standard-pressure
  // approximation for AMSL feet, retaining original units for display.
  if(altitude.unit === 'FT' && ['AMSL','STD'].includes(altitude.ref)) return altitude.value / 100;
  return null;
}

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
      const isTma = !!props?.tma;
      const bands = isTma
        ? (Array.isArray(props.vertical_bands) ? props.vertical_bands.map(band=>({
          minFl:altitudeToFl(band?.floor), maxFl:altitudeToFl(band?.ceiling),
          floor:band?.floor, ceiling:band?.ceiling,
        })) : [])
        : [{minFl:props?.min_fl, maxFl:props?.max_fl}];
      if(!props?.sector || (isTma ? !props.icao : !props.vertical)
        || !bands.length || bands.some(band=>!Number.isFinite(band.minFl) || !Number.isFinite(band.maxFl) || band.maxFl <= band.minFl)
        || !polygons.length || polygons.some(polygon=>!polygon)){
        complete = false;
        continue;
      }
      const code = String(props.sector);
      const vertical = isTma ? (code === 'UTMA' ? 'UTMA' : 'TMA') : String(props.vertical);
      const id = isTma ? `TMA:${props.icao}:${props.tma_id || `${props.tma}:${code}`}` : `${code}:${vertical}`;
      const name = isTma ? `${props.tma}${['UTMA','TMA'].includes(code) ? '' : ` ${code}`}` : (props.name || `${code} ${vertical}`);
      bands.forEach((band, bandIndex)=>sectors.push({
        id:bands.length > 1 ? `${id}:${bandIndex}` : id, code, vertical, name,
        kind:isTma ? 'TMA' : 'ACC',
        // Local terminal volumes mask broad UTMAs where both match in 3D.
        priority:isTma ? (vertical === 'UTMA' ? 1 : 2) : 0,
        ...band, polygons,
      }));
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
  const highestPriority = Math.max(-1, ...[...matches.values()].map(sector=>sector.priority));
  const sectors = [...matches.values()].filter(sector=>sector.priority === highestPriority);
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
  const names = membership.sectors.map(sector=>`${sector.name} (${sectorLimitsText(sector)})`);
  return `${names.length > 1 ? 'Sectors (boundary/overlap)' : 'Sector'}: ${names.join(' | ')}`;
}

export function sectorLimitsText(sector){
  const format = (altitude, fallbackFl)=>altitude?.unit === 'FT'
    ? `${altitude.value} FT ${altitude.ref}`
    : `FL${String(altitude?.value ?? fallbackFl).padStart(3,'0')}`;
  return `${format(sector.floor,sector.minFl)}–${format(sector.ceiling,sector.maxFl)}`;
}
