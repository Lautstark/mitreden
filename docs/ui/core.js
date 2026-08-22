/* The page, the words, and the small things every view needs.
 *
 * $ and say touch the DOM; t and tn are the language; post is the one way
 * anything reaches the backend.
 *
 * Part of mitreden's interface; ui/main.js wires the views together.
 */

import { backend } from '../app/backend.js';

export const $=id=>document.getElementById(id);

// --- Woher die Daten kommen -------------------------------------------
// Nothing here leaves the machine. backend-local.js answers everything out of
// the browser itself — IndexedDB for the sentences, piper compiled to WASM for
// the voice — and sets MITREDEN_BACKEND before this file runs.
//
// It still goes through one object rather than being called directly, because
// the routes are the seam: they are what a second implementation would have to
// answer, and what the container used to answer before there was no container.
// --- Woher die Daten kommen -------------------------------------------
// Nothing here leaves the machine. backend-local.js answers everything out of
// the browser itself — IndexedDB for the sentences, piper compiled to WASM for
// the voice — and sets MITREDEN_BACKEND before this file runs.
//
// It still goes through one object rather than being called directly, because
// the routes are the seam: they are what a second implementation would have to
// answer, and what the container used to answer before there was no container.
export const api = backend;

// --- Sprachen ---------------------------------------------------------
// The strings come from lang/*.json so that translating means editing a file,
// not hunting through the program. Keys are English; a key that is missing in
// one language falls back to English, and then to the key itself, so a gap is
// visible instead of blank.
// --- Sprachen ---------------------------------------------------------
// The strings come from lang/*.json so that translating means editing a file,
// not hunting through the program. Keys are English; a key that is missing in
// one language falls back to English, and then to the key itself, so a gap is
// visible instead of blank.
let STR={}, LANG='de';
const NAMES={de:'Deutsch',en:'English'};

export function t(key,vars){
  const set=STR[LANG]||{}, fallback=STR.en||{};
  let s=set[key]!==undefined?set[key]:(fallback[key]!==undefined?fallback[key]:key);
  if(vars)for(const k in vars)s=s.split('{'+k+'}').join(vars[k]);
  return s;
}
// Singular and plural are separate keys — languages disagree about where the
// line falls, and "1 Sätze" is the kind of thing you stop seeing yourself.
// Singular and plural are separate keys — languages disagree about where the
// line falls, and "1 Sätze" is the kind of thing you stop seeing yourself.
export const tn=(key,n,vars)=>t(key+(n===1?'_one':'_other'),Object.assign({n},vars));

/* Applies the words to the markup. Redrawing the data is somebody else's
 * job — core does not know what a sentence is. */
/* What to do once the words have changed. main fills this in: core knows how
 * to swap the language, not what else on the screen is showing data. */
let afterLang = () => {};
export const onLanguageChange = fn => { afterLang = fn; };

export function applyLang(){
  document.documentElement.lang=LANG;
  for(const el of document.querySelectorAll('[data-i18n]'))
    el.textContent=t(el.dataset.i18n);
  for(const el of document.querySelectorAll('[data-i18n-ph]'))
    el.placeholder=t(el.dataset.i18nPh);
  for(const el of document.querySelectorAll('[data-i18n-title]'))
    el.title=t(el.dataset.i18nTitle);
  for(const el of document.querySelectorAll('[data-i18n-aria]'))
    el.setAttribute('aria-label',t(el.dataset.i18nAria));
}

// --- Einstellungen ----------------------------------------------------
export async function loadStrings(){
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
    afterLang();
  };
}
export const say=m=>{const e=$('s');e.textContent=m||'';e.hidden=!m};
// Every row names its own voice now: they can differ from each other, so the
// header no longer answers the question for the whole list.
// Either it is not recorded, or you get the voice it is recorded in. Saying
// "recorded" as well would be a word that is true of every row.
// The row menu answers "what can I do with this phrase". This is the same
// question for several of them, so it is the same menu — not a bar that grows
// another control for every new action.
export function menuOn(btn,build){
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
export function closeMenus(){
  for(const m of document.querySelectorAll('.menu'))m.remove();
  // Every button that opens one, not just the row's — the one in the action
  // bar kept saying "open" after the first click and refused to open again.
  for(const b of document.querySelectorAll('[aria-haspopup="true"]'))
    b.setAttribute('aria-expanded','false');
}
export async function post(url,body){
  const r=await api.post(url,body);
  if(!r.ok){say(t('failed',{error:await r.text()}));return null}
  return r.json();
}
