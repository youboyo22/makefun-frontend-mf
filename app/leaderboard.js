// Surface 3: a bounty's leaderboard. One request (rows=first: ten full rows and every other row
// slim, 20x smaller than the full table), then a virtual window: however many thousand entries a
// bounty has, only the rows on screen exist in the DOM, and scrolling recycles the same elements.

import { h, setText, addStyles, count, score, bountyTabs } from './app.js';

export const path = (slug) => `/competitions/${encodeURIComponent(slug)}/leaderboard?rows=first`;

const ROW_PX = 44;
const OVERSCAN = 4;

addStyles(`
.vl{height:calc(100vh - 300px);min-height:300px;overflow-y:auto;border:1px solid var(--line)}
.vl>div{position:relative}
.vr{position:absolute;left:0;right:0;top:0;height:${ROW_PX}px;display:grid;grid-template-columns:52px 1fr 76px;gap:0 10px;align-items:center;padding:0 10px;border-bottom:1px solid var(--line);color:var(--ink)}
.vr:hover{background:var(--panel);text-decoration:none}
.vr>b{color:var(--warn)}
.vr>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vr>span i{display:block;font-style:normal;font-size:12px;color:var(--link);overflow:hidden;text-overflow:ellipsis}
.vr>em{font-style:normal;font-weight:700;color:var(--go);text-align:right;background:linear-gradient(var(--line),var(--line)) no-repeat 0 100%/var(--w,0%) 3px}
@media(min-width:620px){.vr{grid-template-columns:64px 1fr 120px}}
`);

/** A windowed list: a spacer as tall as every row, and a small pool of rows moved into view. */
export function virtualRows(box, makeRow, fillRow, onDraw) {
  const spacer = box.appendChild(h('div'));
  const pool = [];
  let items = [];
  let version = 0;
  let frame = 0;

  function drawWindow() {
    frame = 0;
    const size = Math.ceil(box.clientHeight / ROW_PX) + OVERSCAN * 2;
    while (pool.length < size) spacer.append((pool[pool.length] = makeRow()));
    const first = Math.max(0, Math.floor(box.scrollTop / ROW_PX) - OVERSCAN);
    for (let i = first; i < first + pool.length; i++) {
      const row = pool[i % pool.length];
      row.hidden = i >= items.length;
      if (row.hidden || (row.at === i && row.version === version)) continue; // still showing this entry
      row.at = i;
      row.version = version;
      row.style.transform = `translateY(${i * ROW_PX}px)`;
      fillRow(row, items[i]);
    }
    onDraw(items.length, Math.min(pool.length, items.length));
  }

  box.addEventListener('scroll', () => (frame ||= requestAnimationFrame(drawWindow)), { passive: true });
  new ResizeObserver(drawWindow).observe(box); // also the first draw, once the box has a height
  return (next) => {
    items = next;
    version++;
    spacer.style.height = `${items.length * ROW_PX}px`;
    drawWindow();
  };
}

/** The ten full rows and the slim rest, as one flat list of what a row shows. */
function flatten(data) {
  const key = data.rank_key;
  const top = (data.entries ?? []).map((e) => ({ ...e, value: e.values?.[key], display: e.display?.[key] }));
  return top.concat(data.rest ?? []).filter((e) => e.ranked !== false);
}

export function mount(view, slug, first) {
  let rows = [];
  let column = null;
  let best = 1;
  const title = h('h1');
  const phase = h('p.dim');
  const tally = h('p.st', { role: 'status' });
  const filter = h('input', { type: 'search', placeholder: 'filter by handle or entry title…', 'aria-label': 'Filter entries' });
  const box = h('div.vl', { tabindex: '0', 'aria-label': 'Ranked entries' });

  const setRows = virtualRows(box,
    () => h('a.vr', h('b'), h('span', h('i')), h('em')),
    (row, e) => {
      const [rank, who, value] = row.children;
      if (e.handle && !e.house && !e.baseline) row.href = '#/u/' + encodeURIComponent(e.handle);
      else row.removeAttribute('href');
      rank.textContent = `#${e.rank ?? '—'}`;
      who.firstChild.nodeType === 3 ? (who.firstChild.data = e.title || 'Untitled entry') : who.prepend(e.title || 'Untitled entry');
      who.lastChild.textContent = e.house ? 'HOUSE ENTRY' : e.baseline ? 'BASELINE' : e.handle ? `@${e.handle}` : 'unnamed entrant';
      value.textContent = score(column, e.value, e.display);
      value.style.setProperty('--w', `${Math.max(0, Math.min(100, (e.value / best) * 100))}%`);
    },
    (total, inDom) => setText(tally, `${count(total)} of ${count(rows.length)} ranked entries · ${inDom} rows in the DOM (virtual window)`));

  function applyFilter() {
    const q = filter.value.trim().toLowerCase();
    setRows(q ? rows.filter((e) => `${e.handle} ${e.title}`.toLowerCase().includes(q)) : rows);
  }
  filter.addEventListener('input', applyFilter);

  view.replaceChildren(...bountyTabs(slug, true), title, phase, h('div.ctl', filter), box, tally);

  /** A revalidated answer swaps the data under the same window: no row element is rebuilt. */
  function patch(data) {
    rows = flatten(data);
    column = (data.columns ?? []).find((c) => c.key === data.rank_key);
    best = Math.max(1, ...rows.slice(0, 50).map((e) => Number(e.value) || 0));
    document.title = `Leaderboard · ${data.competition?.title ?? slug} · MISSION CONTROL`;
    setText(title, `Leaderboard · ${data.competition?.title ?? slug}`);
    setText(phase, `${data.phase?.title ?? 'Current'} phase · ranked by ${column?.title ?? data.rank_key}${data.tie_break ? ` · ties by ${data.tie_break.title}` : ''}`);
    applyFilter();
  }
  patch(first);
  return patch;
}
