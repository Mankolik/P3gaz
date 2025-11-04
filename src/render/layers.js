export function registerLayer(state, name, type='polygon'){
  if(!state.map.layers.has(name)) state.map.layers.set(name, { visible:true, type, features:[] });
}
export function addFeatures(state, name, features){
  const L = state.map.layers.get(name); if(!L) return;
  L.features.push(...features);
}
export function getVisibleLayers(state){
  return [...state.map.layers.entries()].filter(([_,L])=>L.visible);
}
