// Directional route/operator pools supplied by the user. No reverse-route or
// source-variant fallback: absent data must be fixed before traffic can spawn.
export function parseRouteAircraft(text) {
  const pools=new Map();
  let operators=null;
  for(const [index,raw] of text.replace(/^\uFEFF/,'').split(/\r?\n/).entries()) {
    const line=raw.trim();
    if(!line)continue;
    if(/^[A-Z]{4}-[A-Z]{4}$/.test(line)) {
      if(pools.has(line))throw new Error(`Duplicate aircraft route ${line}.`);
      operators={};pools.set(line,operators);continue;
    }
    const match=line.match(/^([A-Z]{3})\s+([A-Z0-9]{2,4}(?:\s*,\s*[A-Z0-9]{2,4})*)$/);
    if(!operators || !match)throw new Error(`Invalid aircraft pool at line ${index+1}.`);
    if(operators[match[1]])throw new Error(`Duplicate aircraft operator at line ${index+1}.`);
    operators[match[1]]=[...new Set(match[2].split(/\s*,\s*/))];
  }
  if(!pools.size || [...pools.values()].some(ops=>!Object.keys(ops).length))throw new Error('Incomplete aircraft pools.');
  return pools;
}

export function applyRouteAircraft(catalogue,pools) {
  return {...catalogue,groups:catalogue.groups.map(group=>{
    const pair=`${group.departure}-${group.destination}`;
    const aircraftTypesByOperator=pools.get(pair);
    for(const callsign of group.callsigns) {
      if(!aircraftTypesByOperator?.[callsign.slice(0,3)]?.length)
        throw new Error(`Missing aircraft pool for ${pair} / ${callsign.slice(0,3)}.`);
    }
    return {...group,aircraftTypesByOperator};
  })};
}
