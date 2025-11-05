// Very light normalizer. Expects WGS84 lon/lat.
export function normalizeGeoJSON(geojson, project){
  const feats = [];
  let proj = project;
  if(!proj){
    let latSum = 0; let count = 0;
    for(const g of (geojson.features||[])){
      const geom = g?.geometry;
      if(!geom) continue;
      if(geom.type==='Polygon'){
        for(const ring of geom.coordinates||[]){
          for(const coord of ring||[]){ if(coord?.length>1){ latSum += coord[1]; count++; } }
        }
      } else if(geom.type==='MultiPolygon'){
        for(const poly of geom.coordinates||[]){
          for(const ring of poly||[]){
            for(const coord of ring||[]){ if(coord?.length>1){ latSum += coord[1]; count++; } }
          }
        }
      } else if(geom.type==='Point'){
        const coord = geom.coordinates;
        if(Array.isArray(coord) && coord.length>1){ latSum += coord[1]; count++; }
      } else if(geom.type==='MultiPoint'){
        for(const coord of geom.coordinates||[]){ if(coord?.length>1){ latSum += coord[1]; count++; } }
      }
    }
    const meanLat = count ? latSum / count : 0;
    const lonScale = Math.cos(meanLat * Math.PI / 180) || 1;
    const factor = 10000;
    proj = (lon,lat)=> [lon*lonScale*factor, -lat*factor];
  }
  const pushPolygon = (coords, props)=>{
    if(!Array.isArray(coords) || !coords.length) return;
    const ring = coords[0].map(([lon,lat])=>proj(lon,lat));
    if(ring.length) feats.push({ type:'polygon', xy:ring, props });
  };
  const pushPoint = (coord, props)=>{
    if(!Array.isArray(coord) || coord.length<2) return;
    const [lon,lat] = coord; const [x,y] = proj(lon,lat);
    feats.push({ type:'point', x, y, props });
  };
  for(const g of (geojson.features||[])){
    const geom = g.geometry;
    if(!geom) continue;
    const props = g.properties || {};
    if(geom.type==='Polygon'){
      pushPolygon(geom.coordinates, props);
    } else if(geom.type==='MultiPolygon'){
      geom.coordinates.forEach(poly=>pushPolygon(poly, props));
    } else if(geom.type==='Point'){
      pushPoint(geom.coordinates, props);
    } else if(geom.type==='MultiPoint'){
      geom.coordinates.forEach(pt=>pushPoint(pt, props));
    }
  }
  return feats;
}
