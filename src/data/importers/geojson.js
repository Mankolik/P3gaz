// Very light normalizer. Expects WGS84 lon/lat.
export function normalizeGeoJSON(geojson, project){
  const feats = [];
  const proj = (lon,lat)=> [lon*10000, -lat*10000]; // fast equirect to XY (placeholder)
  for(const g of (geojson.features||[])){
    if(g.geometry?.type==='Polygon'){
      const ring = g.geometry.coordinates[0].map(([lon,lat])=>proj(lon,lat));
      feats.push({ type:'polygon', xy:ring, props:g.properties||{} });
    } else if(g.geometry?.type==='Point'){
      const [lon,lat]=g.geometry.coordinates; const [x,y]=proj(lon,lat);
      feats.push({ type:'point', x, y, props:g.properties||{} });
    }
  }
  return feats;
}
