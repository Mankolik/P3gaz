export function registerLayer(state, name, type='polygon'){
  if(!state.map.layers.has(name)) state.map.layers.set(name, { visible:true, type, features:[] });
}
export function addFeatures(state, name, features){
  const L = state.map.layers.get(name); if(!L) return;
  L.features.push(...features);
}
const LAYER_PRIORITY_ORDER = [
  'CTR',
  'TMA',
  'SECTOR_LOW',
  'SECTOR_HIGH',
  'FIR',
  'ZONES',
  // Waypoints and airports are currently rendered as points. They should
  // appear on top of the polygons defined above when overlaps happen.
  'WAYPOINTS',
  'AIRPORTS',
];

const LAYER_PRIORITY = new Map(
  LAYER_PRIORITY_ORDER.map((name, index) => [name, index])
);

function getLayerRank(name, fallbackIndex){
  if(LAYER_PRIORITY.has(name)) return LAYER_PRIORITY.get(name);
  // Layers that are not explicitly listed fall back below the known layers
  // so that they do not obscure them. Preserve their relative order by
  // offsetting with the original index from the map iteration.
  return -1 - fallbackIndex;
}

export function getVisibleLayers(state){
  const entries = [...state.map.layers.entries()];
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry: [, layer] }) => layer.visible)
    .sort((a, b) => {
      const [nameA] = a.entry;
      const [nameB] = b.entry;
      const rankA = getLayerRank(nameA, a.index);
      const rankB = getLayerRank(nameB, b.index);
      return rankA - rankB;
    })
    .map(({ entry }) => entry);
}
