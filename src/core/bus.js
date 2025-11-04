export function createBus(){
  const map = new Map();
  return {
    on(evt, fn){ if(!map.has(evt)) map.set(evt, new Set()); map.get(evt).add(fn); return ()=>map.get(evt)?.delete(fn); },
    emit(evt, payload){ map.get(evt)?.forEach(fn=>fn(payload)); }
  };
}
