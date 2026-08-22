/* What is loaded, what is selected, and what the list should show.
 *
 * Part of mitreden's interface; ui/main.js wires the views together.
 */

import { $, t } from './core.js';
// The backend directly, not through core: core is where the page and the words
// live, and routing data through it would make the two import each other for
// no reason.
import { backend as api } from '../app/backend.js';

/* Who wants to know when the data changes. The views subscribe, nothing
 * subscribes to a view, and so no view has to import another — which is what
 * kept the old single file tangled. */
const watchers = [];
export const subscribe = fn => { watchers.push(fn); };
export const notify = () => { for (const fn of watchers) fn(); };

export let ALL=[];
// The Sammlungen that exist, in the order they were made. Not derived from
// the sentences: an empty one has to survive being empty.
// The Sammlungen that exist, in the order they were made. Not derived from
// the sentences: an empty one has to survive being empty.
export let DECLARED=[];   // [{key,name,count}] — key is what a sentence points at
// Which rows are ticked. Kept across redraws, so filtering or searching does
// not quietly drop what you picked; ids that vanish are pruned on load.
// Which rows are ticked. Kept across redraws, so filtering or searching does
// not quietly drop what you picked; ids that vanish are pruned on load.
export const SEL=new Set();
// Several collections can be picked at once and they combine with OR: two books
// and you get the phrases of both. The free text search narrows that further,
// so the two mechanisms are ANDed with each other.
// Several collections can be picked at once and they combine with OR: two books
// and you get the phrases of both. The free text search narrows that further,
// so the two mechanisms are ANDed with each other.
export const COLLECTIONS=new Set();
// One collection per picture book adds up fast. Only the most used are on
// screen; the rest is one click away, and the search finds their names too.
// Which voices are picked. NOCHNICHT stands for "not recorded at all" — the
// same question ("what does this sound like?") with the answer "nothing yet".
export const VOICES=new Set(), NOCHNICHT='\u2205';

// One collection per picture book adds up fast. Only the most used are on
// screen; the rest is one click away, and the search finds their names too.
export const CHIP_CAP=12;

// Rendering thousands of rows makes the page crawl, and nobody reads that far
// anyway — search and collections are the real answer to a big set. So the
// list stops here and offers the rest on request. Counts and downloads always
// cover everything that matches, not just what is drawn.
// Rendering thousands of rows makes the page crawl, and nobody reads that far
// anyway — search and collections are the real answer to a big set. So the
// list stops here and offers the rest on request. Counts and downloads always
// cover everything that matches, not just what is drawn.
export const CAP=200;

// Searching German without a German keyboard: "hor auf", "hoer auf" and
// "Hör auf" all have to find the same phrase. So every phrase is indexed in
// both spellings and the query is tried in both, too.
// Searching German without a German keyboard: "hor auf", "hoer auf" and
// "Hör auf" all have to find the same phrase. So every phrase is indexed in
// both spellings and the query is tried in both, too.
const bare=s=>s.toLowerCase().replace(/ß/g,'ss')
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const umlaut=s=>s.toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe')
  .replace(/ü/g,'ue').replace(/ß/g,'ss');
const hay=i=>bare(i.text)+' | '+umlaut(i.text)+' | '+(i.collections||[]).join(' ');

export function found(){
  const q=$('q').value.trim();
  if(!q)return ALL;
  const a=bare(q), b=umlaut(q);
  return ALL.filter(i=>{const h=hay(i);return h.includes(a)||h.includes(b)});
}
// What the list shows: search first, then the collection filter, then the voice
// filter. Every axis narrows; none of them changes anything.
// What the list shows: search first, then the collection filter, then the voice
// filter. Every axis narrows; none of them changes anything.
export const voiceOf=i=>i.state==='missing'?NOCHNICHT:(i.voice||NOCHNICHT);
export const shown=()=>{
  let f=found();
  if(COLLECTIONS.size)f=f.filter(i=>(i.collections||[]).some(x=>COLLECTIONS.has(x)));
  if(VOICES.size)f=f.filter(i=>VOICES.has(voiceOf(i)));
  return f;
};

// Every row names its own voice now: they can differ from each other, so the
// header no longer answers the question for the whole list.
// Either it is not recorded, or you get the voice it is recorded in. Saying
// "recorded" as well would be a word that is true of every row.
export const stateText=it=>it.state==='missing'?t('state_missing')
                  :it.state==='stale'?t('state_stale')
                  :(it.voice||t('state_recorded'));
export async function load(){
  const data=await (await api.get('/api/phrases')).json();
  ALL=data.items||[];
  DECLARED=data.collections||[];
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
  notify();
}
