/* mitreden's interface.
 *
 * The page is markup and style; everything it does is here and in the modules
 * beside it. It talks to app/backend.js through one object, which is the seam
 * that used to be an HTTP server.
 */

import { backend } from '../app/backend.js';

const $=id=>document.getElementById(id);

// --- Woher die Daten kommen -------------------------------------------
// Nothing here leaves the machine. backend-local.js answers everything out of
// the browser itself — IndexedDB for the sentences, piper compiled to WASM for
// the voice — and sets MITREDEN_BACKEND before this file runs.
//
// It still goes through one object rather than being called directly, because
// the routes are the seam: they are what a second implementation would have to
// answer, and what the container used to answer before there was no container.
const api = backend;

// --- Sprachen ---------------------------------------------------------
// The strings come from lang/*.json so that translating means editing a file,
// not hunting through the program. Keys are English; a key that is missing in
// one language falls back to English, and then to the key itself, so a gap is
// visible instead of blank.
let STR={}, LANG='de';
const NAMES={de:'Deutsch',en:'English'};

function t(key,vars){
  const set=STR[LANG]||{}, fallback=STR.en||{};
  let s=set[key]!==undefined?set[key]:(fallback[key]!==undefined?fallback[key]:key);
  if(vars)for(const k in vars)s=s.split('{'+k+'}').join(vars[k]);
  return s;
}
// Singular and plural are separate keys — languages disagree about where the
// line falls, and "1 Sätze" is the kind of thing you stop seeing yourself.
const tn=(key,n,vars)=>t(key+(n===1?'_one':'_other'),Object.assign({n},vars));

function applyLang(){
  document.documentElement.lang=LANG;
  for(const el of document.querySelectorAll('[data-i18n]'))
    el.textContent=t(el.dataset.i18n);
  for(const el of document.querySelectorAll('[data-i18n-ph]'))
    el.placeholder=t(el.dataset.i18nPh);
  for(const el of document.querySelectorAll('[data-i18n-title]'))
    el.title=t(el.dataset.i18nTitle);
  for(const el of document.querySelectorAll('[data-i18n-aria]'))
    el.setAttribute('aria-label',t(el.dataset.i18nAria));
  draw();
}

// --- Einstellungen ----------------------------------------------------
$('dlall').onclick=e=>menuOn(e.currentTarget,(m,add)=>{
  const ids=shown().filter(i=>i.state!=='missing').map(i=>i.id);
  add(t('download_mp3'),false,()=>{closeMenus();grabMany(ids,'mp3')});
  add(t('download_wav'),false,()=>{closeMenus();grabMany(ids,'wav')});
});

$('colmore').onclick=e=>menuOn(e.currentTarget,(m,add)=>{
  const here=DECLARED.find(c=>COLLECTIONS.has(c.key))||DECLARED[0];
  if(!here)return;
  add(t('collection_export'),false,()=>{closeMenus();exportCollection(here)});
  add(t('collection_delete'),true,()=>{closeMenus();deleteCollection(here.key,here.name,here.count)});
});

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

async function drawSetup(){
  const st=await (await api.get('/api/setup')).json();
  const box=$('cloud');box.innerHTML='';
  for(const c of st.cloud){
    const d=document.createElement('div');d.className='card';
    d.innerHTML='<div class="card__head"><h3></h3><span class="badge state"></span></div>'+
      '<p class="sub body"></p><p class="warn"></p>'+
      '<label></label><input type="password" autocomplete="off">'+
      (c.needs_region?'<label class="region"></label><input class="region" type="text">':'')+
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
            reg.value=c.region||''}
    d.querySelector('.save').textContent=t('key_save');
    const forget=d.querySelector('.forget');
    forget.textContent=t('key_forget');forget.hidden=!c.set;
    d.querySelector('.save').onclick=()=>saveKey(c,key.value,reg?reg.value:'');
    forget.onclick=()=>saveKey(c,'',reg?reg.value:'');
    box.appendChild(d);
  }
}

// One row of tabs, one pane visible. The panes are in the markup rather than
// built here, so a translator can see them.
for(const b of document.querySelectorAll('#tabs .tab')){
  b.onclick=()=>{
    for(const x of document.querySelectorAll('#tabs .tab'))x.classList.toggle('on',x===b);
    for(const p of document.querySelectorAll('.pane'))p.hidden=p.dataset.pane!==b.dataset.tab;
  };
}

async function saveKey(c,key,region){
  const r=await api.post('/api/setup',{backend:c.id,key,region});
  if(!r.ok){say(t('key_failed',{error:await r.text()}));return}
  const d=await r.json();
  say(d.set?t('key_saved',{label:c.label,n:d.voices})
           :t('key_removed',{label:c.label}));
  drawSetup();loadVoices();load();
}

$('gear').onclick=()=>{drawSetup();$('setup').showModal()};
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
  loadVoices();load();
};

$('setupclose').onclick=()=>$('setup').close();

async function loadStrings(){
  STR=await (await api.get('/api/strings')).json();
  const codes=Object.keys(STR);
  // What you picked last, else what the browser asks for, else English.
  // A German browser says de, de-AT or de-CH — the first two letters are
  // enough. Anything we do not have falls back to English, because that is
  // the language most likely to be understood by someone who is neither.
  const wanted=new URLSearchParams(location.search).get('lang')
    ||localStorage.getItem('mitreden.lang')
    ||(navigator.language||'').slice(0,2).toLowerCase();
  LANG=codes.includes(wanted)?wanted:(codes.includes('en')?'en':codes[0]);
  const sel=$('lang');
  sel.innerHTML='';
  for(const c of codes){
    const o=new Option(NAMES[c]||c,c);
    if(c===LANG)o.selected=true;
    sel.appendChild(o);
  }
  sel.onchange=e=>{
    LANG=e.target.value;
    localStorage.setItem('mitreden.lang',LANG);
    const u=new URL(location);u.searchParams.set('lang',LANG);
    history.replaceState(null,'',u);      // reload and sharing keep it
    applyLang();
    if($('setup').open)drawSetup();
  };
}
const say=m=>{const e=$('s');e.textContent=m||'';e.hidden=!m};
// Every row names its own voice now: they can differ from each other, so the
// header no longer answers the question for the whole list.
// Either it is not recorded, or you get the voice it is recorded in. Saying
// "recorded" as well would be a word that is true of every row.
const stateText=it=>it.state==='missing'?t('state_missing')
                  :it.state==='stale'?t('state_stale')
                  :(it.voice||t('state_recorded'));
let ALL=[], SHOW_ALL=false, ALL_TAGS=false;
// The Sammlungen that exist, in the order they were made. Not derived from
// the sentences: an empty one has to survive being empty.
let DECLARED=[];   // [{key,name,count}] — key is what a sentence points at
// Which rows are ticked. Kept across redraws, so filtering or searching does
// not quietly drop what you picked; ids that vanish are pruned on load.
const SEL=new Set();
// Several collections can be picked at once and they combine with OR: two books
// and you get the phrases of both. The free text search narrows that further,
// so the two mechanisms are ANDed with each other.
const COLLECTIONS=new Set();
// One collection per picture book adds up fast. Only the most used are on
// screen; the rest is one click away, and the search finds their names too.
const CHIP_CAP=12;

// Rendering thousands of rows makes the page crawl, and nobody reads that far
// anyway — search and collections are the real answer to a big set. So the
// list stops here and offers the rest on request. Counts and downloads always
// cover everything that matches, not just what is drawn.
const CAP=200;

// Searching German without a German keyboard: "hor auf", "hoer auf" and
// "Hör auf" all have to find the same phrase. So every phrase is indexed in
// both spellings and the query is tried in both, too.
const bare=s=>s.toLowerCase().replace(/ß/g,'ss')
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const umlaut=s=>s.toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe')
  .replace(/ü/g,'ue').replace(/ß/g,'ss');
const hay=i=>bare(i.text)+' | '+umlaut(i.text)+' | '+(i.collections||[]).join(' ');

function found(){
  const q=$('q').value.trim();
  if(!q)return ALL;
  const a=bare(q), b=umlaut(q);
  return ALL.filter(i=>{const h=hay(i);return h.includes(a)||h.includes(b)});
}
// What the list shows: search first, then the collection filter, then the voice
// filter. Every axis narrows; none of them changes anything.
const voiceOf=i=>i.state==='missing'?NOCHNICHT:(i.voice||NOCHNICHT);
const shown=()=>{
  let f=found();
  if(COLLECTIONS.size)f=f.filter(i=>(i.collections||[]).some(x=>COLLECTIONS.has(x)));
  if(VOICES.size)f=f.filter(i=>VOICES.has(voiceOf(i)));
  return f;
};

function chip(label,n,collection,set,where){
  const b=document.createElement('button');
  b.className='chip'+((collection===null?!set.size:set.has(collection))?' on':'');
  b.textContent=label;
  const s=document.createElement('span');s.className='n';s.textContent=n;
  b.appendChild(s);
  b.onclick=()=>{
    if(collection===null)set.clear();
    else if(set.has(collection))set.delete(collection);
    else set.add(collection);
    draw();
  };
  $(where).appendChild(b);
}

// Which voices are picked. NOCHNICHT stands for "not recorded at all" — the
// same question ("what does this sound like?") with the answer "nothing yet".
const VOICES=new Set(), NOCHNICHT='\u2205';
let ALL_VOICES=false;

function drawVoiceChips(hits){
  const counts={};
  for(const i of hits){
    const key=i.state==='missing'?NOCHNICHT:(i.voice||NOCHNICHT);
    counts[key]=(counts[key]||0)+1;
  }
  for(const v of VOICES)if(!(v in counts))counts[v]=0;
  const names=Object.keys(counts).sort((a,b)=>
    a===NOCHNICHT?1:b===NOCHNICHT?-1:a.localeCompare(b,'de'));
  $('vchips').innerHTML='';
  // One voice and nothing missing is no choice at all — the row stays away.
  $('vrow').hidden=names.length<2&&!VOICES.size;
  if($('vrow').hidden)return;
  chip(t('chip_all'),hits.length,null,VOICES,'vchips');
  // Same cap as the collections: a wall of pills is not a filter any more.
  let vis=names;
  if(!ALL_VOICES&&names.length>CHIP_CAP){
    const top=names.slice(0,CHIP_CAP);
    vis=top.concat([...VOICES].filter(v=>!top.includes(v)));
  }
  for(const n of vis)
    chip(n===NOCHNICHT?t('chip_not_recorded'):n,counts[n],n,VOICES,'vchips');
  if(names.length>vis.length||ALL_VOICES&&names.length>CHIP_CAP){
    const b=document.createElement('button');
    b.className='chip fold';
    b.textContent=ALL_VOICES?t('chip_less'):t('chip_more',{n:names.length-vis.length});
    b.onclick=()=>{ALL_VOICES=!ALL_VOICES;draw()};
    $('vchips').appendChild(b);
  }
}

// The rail. Every declared Sammlung has a row whether or not anything is in
// it yet — that is the point of declaring one: you can start a book before you
// have translated a line of it.
//
// A click goes to a Sammlung, the way bildhaft does it, because that is what
// you do all day. Cmd or Ctrl adds a second one, because here a sentence can
// genuinely be in two at once and that has to be reachable.
function drawRail(hits){
  const counts={};
  for(const i of ALL)for(const x of (i.collections||[]))counts[x]=(counts[x]||0)+1;
  const rows=$('rows');
  rows.innerHTML='';

  const row=(name,label,n,on)=>{
    const b=document.createElement('button');
    b.className='row'+(on?' on':'');
    b.innerHTML='<span class="row__name"></span><span class="row__n"></span>';
    b.querySelector('.row__name').textContent=label;
    b.querySelector('.row__n').textContent=n;
    b.onclick=e=>{
      if(name===null){COLLECTIONS.clear()}
      else if(e.metaKey||e.ctrlKey){COLLECTIONS.has(name)?COLLECTIONS.delete(name):COLLECTIONS.add(name)}
      else{COLLECTIONS.clear();COLLECTIONS.add(name)}
      closeRail();draw();
    };
    if(name!==null){
      const m=document.createElement('button');
      m.className='row__more';m.textContent='\u22ef';
      m.setAttribute('aria-haspopup','true');m.setAttribute('aria-expanded','false');
      m.title=t('more_actions');
      m.onclick=e=>{e.stopPropagation();collectionMenu(m,name,label,n)};
      b.appendChild(m);
    }
    rows.appendChild(b);
  };

  $('chint1').textContent=t('compose_hint').replace('Enter ','').replace(/^· /,'');
  for(const c of DECLARED) row(c.key,c.name,c.count,COLLECTIONS.has(c.key));

  // The header names where you are. There is always somewhere to be.
  const here=DECLARED.find(c=>COLLECTIONS.has(c.key))||DECLARED[0];
  // Not while it is being typed in, or the caret jumps to the end mid-word.
  if(document.activeElement!==$('colname'))$('colname').value=here?here.name:'';
}

function collectionMenu(btn,key,label,n){
  menuOn(btn,(m,add)=>{
    add(t('collection_delete'),true,()=>{closeMenus();deleteCollection(key,label,n)});
  });
}

// Renaming happens where the name is, not in a window over it.
function renameCollection(key,label){
  const box=$('newcolname');
  box.hidden=false;box.value=label;box.dataset.rename=key;box.focus();box.select();
}

async function deleteCollection(key,label,n){
  if(!confirm(t('ask_collection_delete',{name:label,n})))return;
  const r=await post('/api/collection',{mode:'delete',name:key});
  if(!r)return;
  COLLECTIONS.delete(key);
  say(t('done_collection_delete',{name:label}));
  load();
}

function closeRail(){
  if(window.matchMedia('(max-width:820px)').matches){
    $('rail').classList.remove('open');$('scrim').hidden=true;
  }
}
$('railopen').onclick=()=>{$('rail').classList.add('open');$('scrim').hidden=false};
$('railclose').onclick=closeRail;
$('scrim').onclick=closeRail;

// Renaming is typing in the title. Saved a beat after you stop, and again on
// the way out, so nothing is lost by clicking away mid-word.
let renameTimer=null;
function scheduleRename(){
  const here=DECLARED.find(c=>COLLECTIONS.has(c.key))||DECLARED[0];
  if(!here)return;
  clearTimeout(renameTimer);
  const to=$('colname').value;
  renameTimer=setTimeout(async()=>{
    if(!to.trim()||to===here.name)return;
    await post('/api/collection',{mode:'rename',name:here.key,to});
    load();
  },400);
}
$('colname').addEventListener('input',scheduleRename);
$('colname').addEventListener('blur',scheduleRename);
$('colname').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.target.blur()}};

$('newcol').onclick=()=>{
  const box=$('newcolname');
  box.hidden=false;box.value='';delete box.dataset.rename;box.focus();
};
$('newcolname').onkeydown=async e=>{
  if(e.key==='Escape'){e.target.hidden=true;return}
  if(e.key!=='Enter')return;
  const value=e.target.value.trim();
  const was=e.target.dataset.rename;
  if(!value){e.target.hidden=true;return}
  const r=was
    ? await post('/api/collection',{mode:'rename',name:was,to:value})
    : await post('/api/collection',{mode:'create',name:value});
  if(!r)return;
  e.target.hidden=true;
  say(was?t('done_edit',{text:r.name}):t('done_collection_new',{name:r.name}));
  load();
};


function draw(){
  const hits=found(), items=shown().slice().reverse();  // newest first

  // Chips count within the current search, so they stay useful while typing.
  drawRail(hits);
  drawVoiceChips(hits);

  const pending=items.filter(i=>i.state!=='ok').length;
  // How much is in the Sammlung you are in. A fraction of everything made
  // sense when a Sammlung was a filter over one long list; now it is a place,
  // and "0 von 3" in an empty one reads as an error rather than as empty.
  // Searching is the one thing that genuinely narrows, so it keeps a fraction.
  const searching=$('q').value.trim().length>0;
  $('count').textContent = searching
    ? t('count_filtered',{n:items.length,all:ALL.length})
    : !items.length ? t('count_none')
      : tn('count',items.length)+
        (pending?t('count_open',{n:pending}):t('count_all_recorded'));


  $('list').innerHTML='';
  if(!items.length){
    const p=document.createElement('p');p.className='empty';
    p.textContent=ALL.length?t('empty_no_match'):t('empty_start');
    $('list').appendChild(p);
    refreshSel();
    return;
  }
  for(const it of (SHOW_ALL?items:items.slice(0,CAP))){
    const d=document.createElement('div');d.className='item '+it.state;
    d.innerHTML='<input type="checkbox" aria-label="'+t('select_one')+'">'+
      '<div class="txt"><div class="line"></div>'+
      '<div class="meta">'+
      '<span class="st"><span class="dot"></span><span class="state"></span></span>'+
      '</div></div>'+
      // The player's own ⋮ menu offers a playback speed that only affects
      // listening here, never the rendered file — and a download of the preview
      // rather than the device files. Both mislead, so both are switched off.
      (it.state==='missing'?'':'<audio controls controlsList="nodownload noplaybackrate" '+
        'disableRemotePlayback preload="none" src="'+api.audio(it.id)+'"></audio>')+
      '<div class="menuwrap"><button class="dots" aria-haspopup="true" '+
      'aria-expanded="false" title="'+t('more_actions')+'" aria-label="'+
      t('more_actions')+'">\u22ee</button></div>';
    const box=d.querySelector('input[type=checkbox]');
    box.checked=SEL.has(it.id);
    box.onchange=()=>{box.checked?SEL.add(it.id):SEL.delete(it.id);refreshSel()};
    d.querySelector('.line').textContent=it.text;
    d.querySelector('.state').textContent=stateText(it);
    const meta=d.querySelector('.meta');
    for(const collection of (it.collections||[])){
      const b=document.createElement('button');
      b.className='collection';b.textContent=collection;b.title=t('collection_title');
      b.onclick=()=>{COLLECTIONS.clear();COLLECTIONS.add(collection);draw()};
      meta.appendChild(b);
    }
    d.querySelector('.dots').onclick=ev=>openMenu(ev.currentTarget,it);
    $('list').appendChild(d);
  }
  if(!SHOW_ALL&&items.length>CAP){
    const b=document.createElement('button');
    b.className='more';b.textContent=t('show_all',{n:items.length});
    b.onclick=()=>{SHOW_ALL=true;draw()};
    $('list').appendChild(b);
  }
  refreshSel();
}

// The row menu answers "what can I do with this phrase". This is the same
// question for several of them, so it is the same menu — not a bar that grows
// another control for every new action.
function menuOn(btn,build){
  const open=btn.getAttribute('aria-expanded')==='true';
  closeMenus();
  if(open)return;
  btn.setAttribute('aria-expanded','true');
  const m=document.createElement('div');m.className='menu';
  build(m,(label,danger,fn)=>{
    const b=document.createElement('button');
    b.textContent=label;
    if(danger)b.className='danger';
    b.onclick=e=>{e.stopPropagation();fn(m)};
    m.appendChild(b);
  });
  btn.parentNode.appendChild(m);
}

// Second level in the same popup: seventeen voices have no place in a bar,
// but they are fine in a list you opened on purpose.
async function voiceMenu(m,apply){
  m.innerHTML='';
  for(const v of await (await api.get('/api/voices')).json()){
    const b=document.createElement('button');
    b.textContent=t('switch_to',{voice:v.label});
    b.onclick=()=>{closeMenus();apply(v.id,v.label)};
    m.appendChild(b);
  }
}

async function switchTo(ids,id,label){
  if(!ids.length)return;
  if(!confirm(tn('ask_switch',ids.length,{voice:label})))return;
  say(t('busy_switch',{voice:label}));
  const r=await post('/api/build',{force:true,ids,voice:id});
  if(r){say(t('done_switch',{n:r.rendered,voice:label}));load()}
}

async function recordMany(ids){
  if(!ids.length){say(t('nothing_to_record'));return}
  say(t('busy_build',{n:ids.length}));
  const d=await post('/api/build',{ids});   // no force: only what is missing
  if(!d)return;
  say(t('done_build',{n:d.rendered}));
  load();
}

async function grabMany(ids,fmt){
  if(!ids.length){say(t('nothing_recorded'));return}
  say(t('busy_pack',{n:ids.length}));
  const r=await api.post('/api/download',{ids,format:fmt});
  if(!r.ok){say(t('failed',{error:await r.text()}));return}
  const url=URL.createObjectURL(await r.blob());
  const a=document.createElement('a');
  a.href=url;a.download='mitreden-'+ids.length+'-'+fmt+'.zip';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  say(t('done_pack',{n:ids.length,format:fmt.toUpperCase()}));
}

async function tagsMany(ids,mode){
  const rein=mode==='add';
  const v=prompt(t(rein?'ask_collections_add':'ask_collections_remove',{n:ids.length}),'');
  if(v===null)return;
  const collections=v.split(',').map(t=>t.trim()).filter(Boolean);
  if(!collections.length){say(t('no_collection_named'));return}
  say(t(rein?'busy_collection_add':'busy_collection_remove'));
  const r=await post('/api/collections',{ids,collections,mode});
  if(r){say(t(rein?'done_collection_add':'done_collection_remove',
                {n:r.ids.length,collections:collections.join(', ')}));load()}
}

async function delMany(ids){
  if(!confirm(tn('ask_delete',ids.length)))return;
  say(t('busy_delete'));
  // One request, and the count comes back from the server. Deleting them one
  // by one meant a failure half way through still reported the full number.
  const r=await post('/api/delete',{ids});
  if(!r)return;
  SEL.clear();
  say(t('done_delete',{n:r.ids.length}));load();
}

$('dlmp3').onclick=()=>grabMany(
  ALL.filter(i=>SEL.has(i.id)&&i.state!=='missing').map(i=>i.id),'mp3');
$('bulk').onclick=e=>menuOn(e.currentTarget,(m,add)=>{
  const ids=[...SEL];
  const fertig=ALL.filter(i=>SEL.has(i.id)&&i.state!=='missing').map(i=>i.id);
  if(fertig.length)
    add(t('download_wav'),false,()=>{closeMenus();grabMany(fertig,'wav')});
  // Sentences that were imported, or whose recording failed, have no audio.
  // Without this there is no way back to one — every other entry here either
  // needs a recording or replaces one.
  const offen=ALL.filter(i=>SEL.has(i.id)&&i.state!=='ok').map(i=>i.id);
  if(offen.length)
    add(t('menu_record'),false,()=>{closeMenus();recordMany(offen)});
  add(t('menu_change_voice'),false,
      mm=>voiceMenu(mm,(id,label)=>switchTo(ids,id,label)));
  add(t('menu_add_collection'),false,()=>{closeMenus();tagsMany(ids,'add')});
  add(t('menu_remove_collection'),false,()=>{closeMenus();tagsMany(ids,'remove')});
  add(tn('menu_delete',ids.length),true,()=>{closeMenus();delMany(ids)});
});

function closeMenus(){
  for(const m of document.querySelectorAll('.menu'))m.remove();
  // Every button that opens one, not just the row's — the one in the action
  // bar kept saying "open" after the first click and refused to open again.
  for(const b of document.querySelectorAll('[aria-haspopup="true"]'))
    b.setAttribute('aria-expanded','false');
}
function openMenu(btn,it){
  menuOn(btn,(m,add)=>{
    add(t('menu_edit_text'),false,()=>{closeMenus();editText(it)});
    if(it.state!=='missing'){
      add(t('download_mp3'),false,()=>{closeMenus();grab(it,'mp3')});
      add(t('download_wav'),false,()=>{closeMenus();grab(it,'wav')});
    }
    add(t('menu_change_voice'),false,
        mm=>voiceMenu(mm,(id,label)=>switchTo([it.id],id,label)));
    add((it.collections||[]).length?t('menu_change_collections'):t('menu_add_to_collection'),
        false,()=>{closeMenus();editTags(it)});
    add(t('menu_delete_one'),true,()=>{closeMenus();del(it)});
  });
}
addEventListener('click',e=>{if(!e.target.closest('.menuwrap'))closeMenus()});
addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus()});

async function load(){
  const data=await (await api.get('/api/phrases')).json();
  ALL=data.items||[];
  DECLARED=data.collections||[];
  await loadVoices(data.voice);
  // A selection survives its Sammlung being emptied — an empty one is still a
  // place, and dropping you out of it the moment you removed the last sentence
  // would be the old derived behaviour wearing the new name. It only goes when
  // the Sammlung itself does.
  for(const x of [...COLLECTIONS])if(!DECLARED.some(c=>c.key===x))COLLECTIONS.delete(x);
  // There is always somewhere to be: if nothing is selected, or what was
  // selected has gone, fall into the first Sammlung rather than showing a
  // list that belongs to nobody.
  if(!COLLECTIONS.size&&DECLARED.length)COLLECTIONS.add(DECLARED[0].key);
  const alive=new Set(ALL.map(i=>i.id));
  for(const id of [...SEL])if(!alive.has(id))SEL.delete(id);  // phrase is gone
  draw();
}
let VOICE_NAMES=[];
async function loadVoices(current){
  const list=await (await api.get('/api/voices')).json();
  VOICE_NAMES=list.map(v=>v.backend==='azure'?'azure':v.label.split(' \u00b7 ')[0]);
  const sel=$('voice'), keep=sel.value;
  sel.innerHTML='';
  if(!list.length){                      // nothing usable: just show it
    sel.appendChild(new Option(current||'\u2014',''));
    sel.disabled=true;
  }else{
    sel.disabled=false;
    for(const v of list){
      const o=new Option(v.label,v.id);
      if(v.id===keep||(!keep&&v.active))o.selected=true;
      sel.appendChild(o);
    }
  }
  $('voice').dataset.was=$('voice').value;
}
// Picking a voice records nothing. It is the voice the next recording gets —
// existing phrases keep theirs until you record them again.
$('voice').onchange=async e=>{
  const sel=e.target, id=sel.value, was=sel.dataset.was;
  const r=await post('/api/voice',{id});
  if(!r){sel.value=was;return}
  sel.dataset.was=id;
  say(t('voice_now',{voice:r.label}));
  draw();                                 // labels name the voice
};
async function grab(it,fmt){
  const url=await api.fileURL(it.id,fmt);
  if(!url){say(t('nothing_recorded'));return}
  const a=document.createElement('a');
  a.href=url;a.download=it.id+'.'+fmt;
  document.body.appendChild(a);a.click();a.remove();
  // A blob URL holds its blob until it is let go of; a path costs nothing.
  if(url.startsWith('blob:'))setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function editText(it){
  const v=prompt(t('ask_edit_text',{text:'\u201E'+it.text+'\u201C',id:it.id}),it.text);
  if(v===null)return;
  if(v.trim()===it.text)return;                 // nichts angefasst
  say(t('busy_record'));
  const r=await post('/api/edit',{id:it.id,text:v});
  if(r){const bad=r.failed||[];
        say(t('done_edit',{text:'\u201E'+r.text+'\u201C'})+
            (bad.length?' '+tn('not_recorded',bad.length,{why:bad[0]}):''));
        load()}
}
async function editTags(it){
  const v=prompt(t('ask_collections_one',{text:'\u201E'+it.text+'\u201C'}),
                 (it.collections||[]).join(', '));
  if(v===null)return;
  const collections=v.split(',');
  const r=await post('/api/collections',{ids:[it.id],collections,mode:'set'});
  if(r){const rest=collections.map(t=>t.trim()).filter(Boolean);
        say(rest.length?t('done_collections_one',{groups:rest.join(', ')})
                       :t('done_collections_none'));load()}
}
async function del(it){
  if(!confirm(t('ask_delete_this',{text:'\u201E'+it.text+'\u201C'})))return;
  say(t('busy_delete'));
  const r=await post('/api/delete',{id:it.id});
  if(r){say(t('done_delete_one',{text:it.text}));load()}
}
async function post(url,body){
  const r=await api.post(url,body);
  if(!r.ok){say(t('failed',{error:await r.text()}));return null}
  return r.json();
}
$('t').onkeydown=e=>{
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('add').click()}
};
$('q').oninput=draw;
$('add').onclick=async()=>{
  const lines=$('t').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if(!lines.length){say(t('type_first'));return}
  // A sentence goes into the Sammlung you are in. There is no field for it,
  // because there is nothing to decide: you opened a Sammlung, you typed, it
  // belongs there. Naming it again in a box beside the text was the old
  // labels-on-a-phrase idea wearing the new word.
  //
  // With several open, or with none, it goes in uncollected. Guessing which of
  // two you meant would be worse than asking nothing.
  const collections=COLLECTIONS.size===1?[...COLLECTIONS]:[];
  say(t('busy_add'));
  const res=await post('/api/phrases',{lines,collections});
  if(res){
    $('t').value='';
    // A phrase that could not be recorded was still added, so the list has to
    // be reloaded either way — and the reason has to be said out loud, or the
    // row just sits there as "not recorded" with nothing explaining why.
    const bad=res.failed||[];
    say(t('done_add',{added:res.added,rendered:res.rendered})+
        (res.merged?t('done_add_twins',{n:res.merged}):'')+'.'+
        (bad.length?' '+tn('not_recorded',bad.length,{why:bad[0]}):''));
    load();
  }
};
function refreshSel(){
  const vis=shown(), ids=vis.map(i=>i.id);
  const picked=ids.filter(i=>SEL.has(i)).length;
  const all=$('selall');
  all.checked=ids.length>0&&picked===ids.length;
  all.indeterminate=picked>0&&picked<ids.length;
  // The button acts on the whole selection, so the label has to name it —
  // including what a filter is currently hiding, or you press a button that
  // touches a phrase you cannot see.
  const versteckt=SEL.size-picked;
  $('selalltxt').textContent=!SEL.size?t('select_all')
    :versteckt?t('selected_hidden',{n:SEL.size,hidden:versteckt})
    :t('selected',{n:SEL.size});
  // Everything you can do with a selection lives behind one button. What the
  // search and the pills do is filter, nothing else.
  $('doing').hidden=!SEL.size;
}
$('selall').onchange=e=>{
  for(const i of shown()) e.target.checked?SEL.add(i.id):SEL.delete(i.id);
  draw();
};
loadStrings().then(()=>{applyLang();load()});
