/* The settings dialog: voices, language, and your data.
 *
 * Part of mitreden's interface; ui/main.js wires the views together.
 */

import { $, api, post, say, t } from './core.js';
import { ALL, load, notify } from './state.js';

export async function drawSetup(){
  const st=await (await api.get('/api/setup')).json();
  const box=$('cloud');box.innerHTML='';
  for(const c of st.cloud){
    const d=document.createElement('div');d.className='card';
    d.innerHTML='<div class="card__head"><h3></h3><span class="badge state"></span></div>'+
      '<p class="sub body"></p><p class="warn"></p>'+
      '<label></label><input type="password" autocomplete="off">'+
      (c.needs_region?'<label class="region"></label>'+
        '<input class="region" type="text" list="azureregions" spellcheck="false">'+
        '<datalist id="azureregions">'+AZURE_REGIONS.map(r=>`<option value="${r}">`).join('')+
        '</datalist><p class="hint region"></p>':'')+
      '<div class="row"><button class="primary save"></button>'+
      '<button class="quiet forget"></button></div>';
    d.querySelector('h3').textContent=c.label;
    const state=d.querySelector('.state');
    state.textContent=c.set?t('key_set'):t('key_unset');
    state.hidden=!c.set;
    d.querySelector('.body').textContent=t('azure_body');
    d.querySelector('.warn').textContent=t('azure_warn');
    d.querySelector('label').textContent=t('key_field');
    const key=d.querySelector('input[type=password]');
    const reg=d.querySelector('input.region');
    if(reg){d.querySelector('label.region').textContent=t('region_field');
            d.querySelector('p.region').textContent=t('region_hint');
            reg.value=c.region||''}
    d.querySelector('.save').textContent=t('key_save');
    const forget=d.querySelector('.forget');
    forget.textContent=t('key_forget');forget.hidden=!c.set;
    d.querySelector('.save').onclick=()=>saveKey(c,key.value,reg?reg.value:'');
    forget.onclick=()=>saveKey(c,'',reg?reg.value:'');
    box.appendChild(d);
  }
}

// Azure's own region names. Not a closed list — a datalist suggests, it does
// not restrict — so a region newer than this file still works by typing it.
const AZURE_REGIONS=['westeurope','northeurope','germanywestcentral','switzerlandnorth',
  'francecentral','uksouth','swedencentral','norwayeast','eastus','eastus2','westus',
  'westus2','westus3','centralus','southcentralus','canadacentral','brazilsouth',
  'australiaeast','southeastasia','eastasia','japaneast','japanwest','koreacentral',
  'centralindia','southafricanorth','uaenorth'];

// The backend answers with a code, so this is the only place that has to know
// the reader's language. It was answering a German page in English.
async function reason(r){
  const body=(await r.text()).trim();
  const [code,rest]=body.split(/:(.*)/s);
  return t(code)!==code?t(code,{error:(rest||'').trim()}):body;
}

async function saveKey(c,key,region){
  const r=await api.post('/api/setup',{backend:c.id,key,region});
  if(!r.ok){say(t('key_failed',{error:await reason(r)}));return}
  const d=await r.json();
  say(d.set?t('key_saved',{label:c.label,n:d.voices})
           :t('key_removed',{label:c.label}));
  drawSetup();notify();load();
}

// One Sammlung as a file, named after it and dated, the way bildhaft names its
// exports — so a folder of them sorts and reads sensibly a year later.
async function exportCollection(c){
  const r=await api.post('/api/export',{collection:c.key});
  if(!r.ok){say(t('failed',{error:await r.text()}));return}
  const safe=(c.name||'sammlung').replace(/[^\p{L}\p{N}\s-]/gu,'').trim()||'sammlung';
  const stamp=new Date().toISOString().slice(0,10);
  const url=URL.createObjectURL(await r.blob());
  const a=document.createElement('a');
  a.href=url;a.download=`mitreden-${safe}-${stamp}.json`;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}

$('gear').onclick=()=>{drawSetup();$('setup').showModal()};
// --- Sichern und Laden ------------------------------------------------
// Only the static site offers these: there the sentences live in the browser
// and nothing else holds a copy. In the container phrases.json is already a
// file you can see, back up and edit.
// --- Sichern und Laden ------------------------------------------------
// Only the static site offers these: there the sentences live in the browser
// and nothing else holds a copy. In the container phrases.json is already a
// file you can see, back up and edit.
$('export').onclick=async()=>{
  const r=await api.get('/api/export');
  if(!r.ok){say(t('failed',{error:await r.text()}));return}
  const url=URL.createObjectURL(await r.blob());
  const a=document.createElement('a');
  a.href=url;a.download='phrases.json';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
};
$('import').onclick=()=>$('importfile').click();
$('importfile').onchange=async e=>{
  const file=e.target.files&&e.target.files[0];
  e.target.value='';                    // so the same file can be picked twice
  if(!file)return;
  say(t('busy_import'));
  let items;
  try{items=JSON.parse(await file.text())}
  catch(err){say(t('import_failed',{error:err.message||err}));return}
  const r=await api.post('/api/import',{items});
  if(!r.ok){say(t('import_failed',{error:await r.text()}));return}
  const d=await r.json();
  if(!d.added&&!d.merged){say(t('import_empty'));return}
  say(t('done_import',d)+(d.revoiced?t('done_import_revoiced',{n:d.revoiced}):''));
  $('setup').close();
  notify();load();
};

$('setupclose').onclick=()=>$('setup').close();

$('wipe').onclick=async()=>{
  if(!confirm(t('danger_ask',{n:ALL.length})))return;
  const r=await post('/api/wipe',{});
  if(!r)return;
  say(t('danger_done'));
  $('setup').close();load();
};
$('import2').onclick=()=>{$('setup').showModal();drawSetup();
  for(const x of document.querySelectorAll('#tabs .tab'))x.classList.toggle('on',x.dataset.tab==='data');
  for(const p of document.querySelectorAll('.pane'))p.hidden=p.dataset.pane!=='data';
  $('importfile').click()};

// One row of tabs, one pane visible. The panes are in the markup rather than
// built here, so a translator can see them.
for(const b of document.querySelectorAll('#tabs .tab')){
  b.onclick=()=>{
    for(const x of document.querySelectorAll('#tabs .tab'))x.classList.toggle('on',x===b);
    for(const p of document.querySelectorAll('.pane'))p.hidden=p.dataset.pane!==b.dataset.tab;
  };
}

