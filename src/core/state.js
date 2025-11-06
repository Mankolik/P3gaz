export function createState(bus){
  return {
    bus,
    ui: {
      top: {
        rangeNm: 40,
        faltOn: false,
        faltMin: 0,
        faltMax: 990,
        qlSectors: [],
        qlOn: false,
        filterOffOn: false,
        sectorName: 'EPWW-T',
        sectorFreq: '134.575',
        menuOn: false,
      },
    },
    map: { layers: new Map(), projection: 'equirect', index: null },
    air: { aircraft: [], routes: [], tracks: [] },
    config: {},
  };
}

const KEY = 'atc-sim-ui-config-v1';
export function loadConfig(state){
  try{ const raw = localStorage.getItem(KEY); if(!raw) return;
    const data = JSON.parse(raw); Object.assign(state.ui.top, data.top||{});
  }catch(e){ /* ignore */ }
}
export function saveConfig(state){
  try{ localStorage.setItem(KEY, JSON.stringify({ top: state.ui.top })); }catch(e){ /* ignore */ }
}
