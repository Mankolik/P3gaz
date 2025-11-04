export function createAircraft(props){ return { id:props.id||crypto.randomUUID(), x:0, y:0, hdg:90, gs:250, alt:300, ...props }; }
