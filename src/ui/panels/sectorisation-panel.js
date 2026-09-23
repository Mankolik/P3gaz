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
  const apply=action('Apply configuration',()=>{
    try{applySectorisation(state,draft);dialog.close();}catch(error){feedback.textContent=error.message;}
  });apply.className='sectorisation-apply';
  footer.append(action('Cancel',()=>dialog.close()),apply);
  dialog.append(title,intro,toolbar,layout,actions,feedback,footer);
  let draft,selected=new Set(),destination;
  button.onclick=()=>{
    draft=cloneSectorisation(state.air.sectorisation || createSectorisation());selected.clear();destination=draft.controlledId;
    render();dialog.showModal();
  };
  selectTarget.onchange=()=>{destination=selectTarget.value;};
  function render(){
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
        if(group?.id===draft.controlledId)cell.classList.add('is-controlled');
      }
      body.append(row);
    }
    groups.append(node('h3','Your controlled sector'));
    groups.append(node('p','Choose one. All others are computer controlled.'));
    for(const group of draft.groups){
      const name=sectorName(group.members),row=node('label',null,'sectorisation-group'),radio=node('input');radio.type='radio';
      radio.name='controlled-sector';radio.value=group.id;radio.checked=draft.controlledId===group.id;
      radio.onchange=()=>{draft.controlledId=group.id;render();groups.querySelector('input:checked')?.focus({preventScroll:true});};
      row.append(radio,node('span',name));groups.append(row);
      const option=node('option',name);option.value=group.id;selectTarget.append(option);
    }
    if(!draft.groups.some(g=>g.id===destination))destination=draft.groups[0]?.id;
    selectTarget.value=destination;
    move.disabled=create.disabled=release.disabled=!selected.size;
    let error='';try{validateSectorisation(draft);}catch(e){error=e.message;}
    if(!state.air.airspaceIndex?.complete)error='Wait for the airspace data to load.';
    apply.disabled=!!error;
    feedback.textContent=error || `${selected.size} selected · ${draft.groups.length} sectors · Changes take effect when you apply.`;
  }
  state.bus?.on('spawner:ready',()=>{if(dialog.open)render();});
  return {button,dialog};
}
