export function initDefaultLayers(state){
  const defs = [
    ['FIR','polygon', true],
    ['SECTOR_LOW','polygon', true],
    ['SECTOR_HIGH','polygon', true],
    ['TMA_LOWER','polygon', true],
    ['TMA_UPPER','polygon', true],
    ['CTR','polygon', true],
    ['ZONES','polygon', true],
    ['WAYPOINTS','point', false],
    ['AIRPORTS','point', false],
    ['ROUTES','polygon', true]
  ];
  defs.forEach(([n,t,visible=true])=>{
    if(!state.map.layers.has(n)){
      state.map.layers.set(n,{visible,type:t,features:[]});
    }
  });
}
