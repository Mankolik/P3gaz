// Very light normalizer. Expects WGS84 lon/lat.
export function normalizeGeoJSON(geojson, project){
  const feats = [];
  const proj = project || ((lon,lat)=> [lon*10000, -lat*10000]); // fast equirect to XY (placeholder)
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
