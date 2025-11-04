export function initDefaultLayers(state){
  const defs = [
    ['FIR','polygon'], ['SECTOR_LOW','polygon'], ['SECTOR_HIGH','polygon'],
    ['TMA','polygon'], ['CTR','polygon'], ['ZONES','polygon'],
    ['WAYPOINTS','point'], ['AIRPORTS','point'], ['ROUTES','polygon']
  ];
  defs.forEach(([n,t])=>{ if(!state.map.layers.has(n)) state.map.layers.set(n,{visible:true,type:t,features:[]}); });
}
