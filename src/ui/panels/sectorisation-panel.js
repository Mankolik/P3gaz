import { SECTOR_CODES, SECTOR_PRESETS, createSectorisation, cloneSectorisation, sectorName, addSectorGroup, moveSectorMembers, validateSectorisation } from '../../radar/sectorisation.js';
import { applySectorisation } from '../../radar/reconfigure-sectors.js';

export function mountSectorisationEditor(parent,state){
  const button=document.createElement('button');button.className='textbtn sectorisation-trigger';button.textContent='Sectorisation';
  button.type='button';parent.append(button);
  const dialog=document.createElement('dialog');dialog.className='sectorisation-editor';
  dialog.setAttribute('aria-labelledby','sectorisation-title');document.body.append(dialog);
  const node=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
  const action=(text,handler)=>{const b=node('button',text);b.type='button';b.onclick=handler;return b;};
  const title=node('h2','Sectorisation');title.id='sectorisation-title';
  const intro=node('p','Select elementary volumes, then move them into a sector or create a new one. Removing volumes makes each one a standalone sector.');
  const toolbar=node('div',null,'sectorisation-toolbar');
  const preset=node('select');preset.setAttribute('aria-label','Named sector');
  for(const name of Object.keys(SECTOR_PRESETS)){const o=node('option',name);o.value=name;preset.append(o);}
  toolbar.append(preset,action('Select named group',()=>{selected=new Set(SECTOR_PRESETS[preset.value]);render();}),
    action('Reset to ALLFIR',()=>{draft=createSectorisation();selected.clear();destination=draft.controlledId;render();}));
  const layout=node('div',null,'sectorisation-layout'),matrix=node('table',null,'sectorisation-matrix'),groups=node('div',null,'sectorisation-groups');
  layout.append(matrix,groups);
  const actions=node('div',null,'sectorisation-actions'),selectTarget=node('select');selectTarget.setAttribute('aria-label','Move to sector');
  const move=action('Move selected',()=>{moveSectorMembers(draft,[...selected],selectTarget.value);selected.clear();render();});
  const create=action('New sector from selected',()=>{destination=addSectorGroup(draft);moveSectorMembers(draft,[...selected],destination);selected.clear();render();});
  const release=action('Make standalone',()=>{moveSectorMembers(draft,[...selected],null);selected.clear();render();});
  actions.append(selectTarget,move,create,release,action('Clear selection',()=>{selected.clear();render();}));
  const feedback=node('p',null,'sectorisation-feedback');feedback.setAttribute('role','status');
  const footer=node('div',null,'sectorisation-footer');
  const apply=action('Apply configuration',async()=>{
    try{
      if(state.multiplayer?.connected)await state.multiplayer.command('configure',{config:draft,assignments,revision});
      else applySectorisation(state,draft);
      dialog.close();
    }catch(error){feedback.textContent=error.message;}
  });apply.className='sectorisation-apply';
  footer.append(action('Cancel',()=>dialog.close()),apply);
  dialog.append(title,intro,toolbar,layout,actions,feedback,footer);
  let draft,selected=new Set(),destination,assignments={},revision;
  button.onclick=()=>{
    draft=cloneSectorisation(state.air.sectorisation || createSectorisation());selected.clear();destination=draft.controlledId;
    assignments=Object.fromEntries((state.multiplayer?.room?.players || []).map(p=>[p.id,p.sectorId]));revision=state.multiplayer?.room?.revision;
    render();dialog.showModal();
  };
  selectTarget.onchange=()=>{destination=selectTarget.value;};
  function render(){
    const online=state.multiplayer?.connected;
    matrix.replaceChildren();groups.replaceChildren();selectTarget.replaceChildren();
    const header=node('tr');for(const text of ['Volume','Low · FL095–365','High · FL365–660'])header.append(node('th',text));
    const head=node('thead');head.append(header);matrix.append(head);
    const body=node('tbody');matrix.append(body);
    for(const code of SECTOR_CODES){
      const row=node('tr');row.append(node('th',code));
      for(const layer of ['LOW','HIGH']){
        const id=`${code}:${layer}`,group=draft.groups.find(g=>g.members.includes(id));
        const cell=node('td'),label=node('label'),input=node('input');input.type='checkbox';input.checked=selected.has(id);
        input.setAttribute('aria-label',`${code} ${layer==='LOW'?'Low':'High'}`);
        input.onchange=()=>{input.checked?selected.add(id):selected.delete(id);render();matrix.querySelector(`[aria-label="${input.getAttribute('aria-label')}"]`)?.focus({preventScroll:true});};
        label.append(input,node('span',sectorName(group?.members || [])));cell.append(label);row.append(cell);
        if(group?.id===(online?assignments[state.multiplayer.playerId]:draft.controlledId))cell.classList.add('is-controlled');
      }
      body.append(row);
    }
    groups.append(node('h3',online?'Assign controllers':'Your controlled sector'));
    groups.append(node('p',online?'Choose a sector or Observer for each player. Unassigned sectors are computer controlled.':'Choose one. All others are computer controlled.'));
    if(online){
      draft.controlledId=draft.groups[0]?.id;
      for(const player of state.multiplayer.room.players){
        const row=node('label',null,'sectorisation-group'),select=node('select');select.setAttribute('aria-label',`Sector for ${player.initials}`);
        const observer=node('option','Observer');observer.value='';select.append(observer);
        for(const g of draft.groups){const option=node('option',sectorName(g.members));option.value=g.id;select.append(option);}
        if(assignments[player.id] && !draft.groups.some(g=>g.id===assignments[player.id])){
          const missing=node('option','Choose replacement…');missing.value=assignments[player.id];missing.disabled=true;select.append(missing);
        }
        select.value=assignments[player.id] || '';select.onchange=()=>{assignments[player.id]=select.value || null;render();};
        row.append(node('span',player.initials),select);groups.append(row);
      }
    }
    for(const group of draft.groups){
      const name=sectorName(group.members),row=node('label',null,'sectorisation-group'),radio=node('input');radio.type='radio';
      radio.name='controlled-sector';radio.value=group.id;radio.checked=draft.controlledId===group.id;
      radio.onchange=()=>{draft.controlledId=group.id;render();groups.querySelector('input:checked')?.focus({preventScroll:true});};
      row.append(radio,node('span',name));if(!online)groups.append(row);
      const option=node('option',name);option.value=group.id;selectTarget.append(option);
    }
    if(!draft.groups.some(g=>g.id===destination))destination=draft.groups[0]?.id;
    selectTarget.value=destination;
    move.disabled=create.disabled=release.disabled=!selected.size;
    let error='';try{validateSectorisation(draft);}catch(e){error=e.message;}
    if(!state.air.airspaceIndex?.complete)error='Wait for the airspace data to load.';
    if(online){
      const choices=Object.values(assignments).filter(Boolean);
      if(choices.some(id=>!draft.groups.some(g=>g.id===id)))error='Choose replacement sectors for affected controllers.';
      else if(new Set(choices).size!==choices.length)error='Two controllers cannot occupy the same sector.';
    }
    apply.disabled=!!error;
    feedback.textContent=error || `${selected.size} selected · ${draft.groups.length} sectors · Changes take effect when you apply.`;
  }
  state.bus?.on('spawner:ready',()=>{if(dialog.open)render();});
  let roster='';
  state.bus?.on('multiplayer:changed',()=>{
    button.disabled=!!state.multiplayer?.connected && !state.multiplayer.isHost();
    const players=state.multiplayer?.room?.players || [],key=JSON.stringify(players.map(p=>p.id));
    if(key!==roster && dialog.open){
      for(const p of players)if(!Object.hasOwn(assignments,p.id))assignments[p.id]=null;
      for(const id of Object.keys(assignments))if(!players.some(p=>p.id===id))delete assignments[id];
      render();
    }
    roster=key;
  });
  return {button,dialog};
}
