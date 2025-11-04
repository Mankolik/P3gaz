import { fitAll } from '../map/map-store.js';
import { registerLayer, addFeatures } from '../render/layers.js';
import { normalizeGeoJSON } from '../data/importers/geojson.js';
import { loadJSON } from '../data/loader.js';
import { initDefaultLayers } from '../map/layers.js';

export function mountTopbar(root, state, bus){
  root.innerHTML = '';

  const el = (t,c,txt)=>{ const n=document.createElement(t); if(c) n.className=c; if(txt) n.textContent=txt; return n; };
  const wrap = (label)=>{ const g=el('div','topgroup'); if(label) g.append(el('div','label',label)); return g; };

  // RANGE
  const gRange=wrap('Range'); const dd=dropdown(state.ui.top.rangeNm+' NM',
    [20,40,60,80,100,120,140,160,180,200].map(n=>({label:n+' NM',value:n})),
    state.ui.top.rangeNm, v=>{ state.ui.top.rangeNm=v; bus.emit('ui:changed'); });
  gRange.append(dd); root.append(gRange);

  // FALT
  const gFalt=wrap('FALT');
  const tF=toggleText(state.ui.top.faltOn, on=>{ state.ui.top.faltOn=on; bus.emit('ui:changed'); });
  const inMin=inputBox(state.ui.top.faltMin, v=>{ state.ui.top.faltMin=clampInt(v,0,990); bus.emit('ui:changed'); });
  const inMax=inputBox(state.ui.top.faltMax, v=>{ state.ui.top.faltMax=clampInt(v,0,990); bus.emit('ui:changed'); });
  gFalt.append(tF,inMin,el('div','label','–'),inMax); root.append(gFalt);

  // QL SC
  const gQLSC=wrap('QL SC'); const ddQL=el('div','dropdown'); ddQL.append(el('div','value','Select sectors'), el('div','chev','▾'));
  const pnlQL=el('div','dropdown-panel'); const tags=el('div','taglist'); pnlQL.append(tags);
  ['B','C','D','E','G','J','N','R','S','T','W','Z'].forEach(s=>{
    const o=el('div','option',s); o.onclick=()=>{ const i=state.ui.top.qlSectors.indexOf(s); i<0?state.ui.top.qlSectors.push(s):state.ui.top.qlSectors.splice(i,1); renderTags(); bus.emit('ui:changed'); };
    pnlQL.append(o);
  });
  function renderTags(){ tags.innerHTML=''; state.ui.top.qlSectors.forEach(s=>tags.append(el('div','tag active',s))); ddQL.querySelector('.value').textContent = state.ui.top.qlSectors.length?state.ui.top.qlSectors.join(', '):'Select sectors'; }
  renderTags(); ddQL.append(pnlQL); attachOpenClose(ddQL); gQLSC.append(ddQL); root.append(gQLSC);

  // QL & Filter OFF
  const gQL=wrap('QL'); gQL.append(toggleText(state.ui.top.qlOn, on=>{ state.ui.top.qlOn=on; bus.emit('ui:changed'); })); root.append(gQL);
  const gOff=wrap('Filter OFF'); gOff.append(toggleText(state.ui.top.filterOffOn, on=>{ state.ui.top.filterOffOn=on; bus.emit('ui:changed'); })); root.append(gOff);

  // Sector info
  const gSec=wrap('Sector');
  const i1=el('div','info'); const kv1=el('div','kv'); kv1.append(el('span','k','Name:'), el('span','v',state.ui.top.sectorName)); i1.append(kv1); gSec.append(i1);
  const i2=el('div','info'); const kv2=el('div','kv'); kv2.append(el('span','k','Freq:'), el('span','v',state.ui.top.sectorFreq)); i2.append(kv2); gSec.append(i2);
  root.append(gSec);

  // FPL (stubs)
  const gFPL=wrap('FPL'); const ddFPL=dropdown('Menu', ['Open FPL list','Create from Call Sign…','Import FPL JSON…','Export FPL JSON'], 'Menu', ()=>{});
  gFPL.append(ddFPL); root.append(gFPL);

  // MAP (stubs)
  const gMAP=wrap('MAP'); const ddMAP=el('div','dropdown'); ddMAP.append(el('div','value','Layers'), el('div','chev','▾'));
  const pnlMAP=el('div','dropdown-panel');
  ['FIR','SECTOR_LOW','SECTOR_HIGH','TMA','CTR','ZONES','WAYPOINTS','AIRPORTS','ROUTES'].forEach(name=>{
    const row=el('div','row'); const lab=el('div','label',name);
    const t=toggleText(true, on=>{ const L=state.map.layers.get(name); if(L){ L.visible=on; bus.emit('ui:changed'); } });
    row.append(lab,t); pnlMAP.append(row);
  });
  ddMAP.append(pnlMAP); attachOpenClose(ddMAP); gMAP.append(ddMAP); root.append(gMAP);

  // CONFIG
  const gCFG=wrap('CONFIG'); const ddCFG=el('div','dropdown'); ddCFG.append(el('div','value','Config'), el('div','chev','▾'));
  const pnlCFG=el('div','dropdown-panel');
  const save=el('div','option','Save Current'); save.onclick=()=>{ localStorage.setItem('atc-config-snapshot', JSON.stringify(state.ui.top)); toast('Saved'); };
  const load=el('div','option','Load Saved'); load.onclick=()=>{ const raw=localStorage.getItem('atc-config-snapshot'); if(!raw) return toast('No saved config'); Object.assign(state.ui.top, JSON.parse(raw)); bus.emit('ui:changed'); toast('Loaded'); };
  const reset=el('div','option','Reset Defaults'); reset.onclick=()=>{ Object.assign(state.ui.top,{rangeNm:40,faltOn:false,faltMin:0,faltMax:990,qlSectors:[],qlOn:false,filterOffOn:false,menuOn:false}); bus.emit('ui:changed'); };
  pnlCFG.append(save,load,reset); ddCFG.append(pnlCFG); attachOpenClose(ddCFG); gCFG.append(ddCFG); root.append(gCFG);

  // UTC clock
  const gClk=wrap('UTC'); const info=el('div','info'); const clk=el('span','value'); info.append(clk); gClk.append(info); root.append(gClk);
  const tick=()=>{ const d=new Date(); clk.textContent=d.toISOString().slice(11,19)+'Z'; }; tick(); setInterval(tick,1000);

  // MENU toggle
  const gMenu=wrap('MENU'); gMenu.append(toggleText(state.ui.top.menuOn, on=>{ state.ui.top.menuOn=on; document.getElementById('bottombar').classList.toggle('hidden', !on); })); root.append(gMenu);

  // helpers
  function elOption(label, fn){ const o=el('div','option',label); o.onclick=fn; return o; }
  function dropdown(label, options, initial, onPick){
    const dd=el('div','dropdown'); const val=el('div','value',label||String(initial)); dd.append(val, el('div','chev','▾'));
    const pnl=el('div','dropdown-panel'); dd.append(pnl);
    const selectOnly=n=>{pnl.querySelectorAll('.option').forEach(o=>o.classList.remove('active')); n.classList.add('active');};
    options.forEach(opt=>{
      const o=el('div','option',opt.label??String(opt)); pnl.append(o);
      if((opt.value??opt)===initial) o.classList.add('active');
      o.onclick=()=>{ selectOnly(o); val.textContent=opt.label??String(opt); onPick(opt.value??opt); dd.classList.remove('open'); bus.emit('ui:changed'); };
    });
    dd.addEventListener('click', (e)=>{ e.stopPropagation(); root.querySelectorAll('.dropdown').forEach(x=>x!==dd&&x.classList.remove('open')); dd.classList.toggle('open'); });
    document.addEventListener('click', (e)=>{ if(!dd.contains(e.target)) dd.classList.remove('open'); });
    return dd;
  }
  function toggleText(initial, onChange){
    const t = el('div','textbtn'); const label = document.createElement('span');
    function set(on){ t.classList.toggle('active', !!on); label.textContent = on ? 'ON' : 'OFF'; }
    set(initial); t.append(label);
    t.onclick = (e)=>{ e.stopPropagation(); set(!t.classList.contains('active')); onChange(t.classList.contains('active')); };
    t.set = set; return t;
  }
  function inputBox(value, onCommit){
    const field=el('div','input'); const inp=document.createElement('input');
    inp.type='text'; inp.value=pad3(value);
    inp.onkeydown = (e)=>{ if(e.key==='Enter') commit(); };
    inp.onblur = commit;
    function commit(){ const v=parseInt(inp.value.replace(/[^-\d]/g,''),10); const vv=Number.isFinite(v)?v:0; const cl=clampInt(vv,0,990); onCommit(cl); inp.value=pad3(cl); }
    field.append(inp); field.set=v=>{ inp.value=pad3(clampInt(v,0,990)); }; return field;
  }
  function attachOpenClose(dd){
    dd.addEventListener('click', (e)=>{ e.stopPropagation(); root.querySelectorAll('.dropdown').forEach(o=>{ if(o!==dd) o.classList.remove('open'); }); dd.classList.toggle('open'); });
  }
  function clampInt(v, lo, hi){ v=parseInt(v,10); if(!Number.isFinite(v)) return lo; return Math.max(lo, Math.min(hi, v)); }
  function pad3(n){ n=parseInt(n,10); if(!Number.isFinite(n)) n=0; return String(Math.max(0, Math.min(990, n))).padStart(3,'0'); }
  function toast(txt){ const t=document.createElement('div'); t.textContent=txt; Object.assign(t.style,{position:'fixed',right:'14px',top:'56px',background:'#122030',border:'1px solid #2c3d4f',padding:'8px 10px',borderRadius:'10px',color:'var(--text)',zIndex:9999,opacity:'0'}); document.body.appendChild(t); requestAnimationFrame(()=>{ t.style.transition='opacity .2s'; t.style.opacity='1'; }); setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(),200); }, 1000); }
}
