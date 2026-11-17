// MISSION CONTROL core: the ETag cache, the hash router, the in-place patchers and the bounty board.
// index.html paints the shell and the board's skeleton by itself; this module fills the board and
// keeps it patched, and fetches each other surface on demand into <main id="view"> alone.

const API = 'https://make.fun/api';
const BOARD_PATH = '/competitions?status=open&activity=times';
const loadBountyPage = () => import('./bounty.js');
const loadVirtualLeaderboard = () => import('./leaderboard.js');
const loadProfile = () => import('./profile.js');
const ROUTES = [[/^#\/b\/([^/]+)\/leaderboard$/, loadVirtualLeaderboard], [/^#\/b\/([^/]+)$/, loadBountyPage], [/^#\/u\/([^/]+)$/, loadProfile]];
const etagCache = new Map(); // path -> { etag, body, at }

/** GET once: a fresh cached answer costs no request, and callers share one in-flight request. */
export function getCached(path) {
  const hit = etagCache.get(path);
  if (hit && Date.now() - hit.at < FRESH_MS) {
    net.memory++;
    showNet();
    return Promise.resolve(hit.body);
  }
  let job = inflight.get(path);
  if (!job) inflight.set(path, (job = revalidateByEtag(path, hit).finally(() => inflight.delete(path))));
  return job;
}

/**
 * Revalidate by ETag. `cache: 'no-cache'` has the browser send If-None-Match from its HTTP cache
 * and settle make.fun's 304 itself: no body on the wire and no preflight. (The header cannot be
 * set from script: make.fun's 304 carries no CORS header, so such a fetch fails when it matches.)
 * An answer whose ETag is the one already held is not parsed again: the same object goes back,
 * and every patcher treats the same object as "nothing to do".
 */
async function revalidateByEtag(path, hit) {
  net.req++;
  const res = await fetch(API + path, { cache: 'no-cache' });
  if (!res.ok) throw Error(`make.fun answered ${res.status}`);
  const etag = res.headers.get('ETag');
  if (hit && etag && etag === hit.etag) {
    net.notModified++;
    hit.at = Date.now();
    res.body?.cancel();
    showNet();
    return hit.body;
  }
  const body = await res.json();
  etagCache.set(path, { etag, body, at: Date.now() });
  showNet();
  return body;
}

/** Keyed in-place list patch: every row keeps its element, only changed text is written. */
export function patchRows(list, items, keyOf, make, update) {
  const rows = list.rowsByKey || (list.rowsByKey = new Map());
  const seen = new Set();
  let prev = null;
  for (const item of items) {
    const key = keyOf(item);
    let row = rows.get(key);
    if (!row) rows.set(key, (row = make(item)));
    update(row, item);
    const next = prev ? prev.nextSibling : list.firstChild;
    if (next !== row) list.insertBefore(row, next);
    prev = row;
    seen.add(key);
  }
  for (const [key, row] of rows) {
    if (seen.has(key)) continue;
    row.remove();
    rows.delete(key);
  }
}

/** Surface 1, the bounty board: paint it from an API answer; the same answer again writes nothing. */
function patchBoard(data, force) {
  if (data === boardData && !force) return;
  boardData = data;
  const q = boardFilter.value.trim().toLowerCase();
  const all = data.items ?? [];
  const live = all.filter((b) => isLive(b.deadline));
  const shown = all
    .filter((b) => !q || `${b.title} ${b.slug} ${b.category}`.toLowerCase().includes(q))
    .sort((a, b) => isLive(b.deadline) - isLive(a.deadline) || BOARD_SORTS[boardSort](a, b));
  patchRows(boardRows, shown, (b) => b.slug, makeBoardRow, updateBoardRow);
  setText(hudLive, live.length);
  setText(hudPot, usd(live.reduce((sum, b) => sum + potOf(b), 0)));
  setText(hudEntries, count(live.reduce((sum, b) => sum + b.submissionCount, 0)));
  const next = live.sort(BOARD_SORTS.t)[0];
  if (next) hudNext.dataset.t = next.deadline;
  boardStatus.textContent = `${shown.length} shown · ${live.length} taking entries · ${all.length - live.length} awaiting results · synced ${new Date().toISOString().slice(11, 19)}Z`;
  markCurrentBounty();
  tickCountdowns();
}

/** One ticker for the clock and every countdown on the page: text nodes only, no layout work. */
function tickCountdowns() {
  if (document.hidden) return;
  clock.textContent = new Date().toISOString().slice(11, 19) + 'Z';
  for (const el of timers) {
    const deadline = el.dataset.t;
    if (!deadline) continue;
    const left = countdown(deadline);
    const text = left || el.dataset.z || '—';
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('hot', !!left && Date.parse(deadline) - Date.now() < 864e5);
    el.classList.toggle('over', !left);
  }
  if (Date.now() - syncedAt > SYNC_MS) syncLive();
}

/** The router: one hash address a surface. Only <main id="view"> is swapped; the shell stays. */
async function routeTo() {
  const hash = location.hash || '#/';
  const mine = ++visit;
  let match;
  const route = ROUTES.find((r) => (match = hash.match(r[0])));
  window.__shotReady = false;
  liveView = null;
  document.body.className = route ? 'sub' : '';
  if (!route) document.title = 'MISSION CONTROL · make.fun bounty board';
  markCurrentBounty();
  scrollTo(0, 0);
  await Promise.all([loadBoard(), route && openSurface(route[1], decodeURIComponent(match[1]), mine)]);
  if (mine === visit) window.__shotReady = true;
}

async function openSurface(load, arg, mine) {
  view.setAttribute('aria-busy', 'true');
  try {
    const surface = await load();
    const path = surface.path(arg);
    const seen = etagCache.get(path)?.body;
    let patch = seen && surface.mount(view, arg, seen); // paint from cache at once, then revalidate
    if (!seen) view.replaceChildren(h('p.wait', 'ACQUIRING SIGNAL…'));
    const data = await getCached(path).catch((err) => {
      if (seen) return seen; // offline or a blip: what is on screen stays, the next sync retries
      throw err;
    });
    if (mine !== visit) return;
    if (!patch) patch = surface.mount(view, arg, data);
    else if (data !== seen) patch(data);
    liveView = { path, patch, data };
    tickCountdowns();
  } catch (err) {
    if (mine !== visit) return;
    const retry = h('button', 'RETRY');
    retry.onclick = routeTo;
    view.replaceChildren(h('p.err', `SIGNAL LOST · ${err.message} `), retry, h('p', h('a', { href: '#/' }, '← back to the board')));
  }
  view.removeAttribute('aria-busy');
}

/** Once a minute, revalidate what is on screen and patch it in place; a 304 changes nothing. */
async function syncLive() {
  syncedAt = Date.now();
  loadBoard();
  const shown = liveView;
  if (!shown) return;
  const data = await getCached(shown.path).catch(() => shown.data);
  if (shown === liveView && data !== shown.data) shown.patch((shown.data = data));
}

function makeBoardRow(b) {
  return h('a.row', { href: '#/b/' + encodeURIComponent(b.slug) },
    h('span.name', h('b', b.title), h('i', `${b.category || 'Bounty'} · ${b.slug}`)),
    h('span.pot'), h('span.fee'), countdownTimer(b.deadline, b.status === 'open' ? 'JUDGING' : 'RESOLVED'), h('span.ent'));
}

function updateBoardRow(row, b) {
  const [, pot, fee, time, entries] = row.children;
  setText(pot, usd(potOf(b)));
  setText(fee, b.entryFeeUsd ? `fee ${usd(b.entryFeeUsd)}` : 'free entry');
  time.dataset.t = b.deadline;
  setText(entries, `${count(b.submissionCount)} entries`);
  row.classList.toggle('off', !isLive(b.deadline));
}

function loadBoard() {
  if (!board.offsetWidth) return; // hidden on a phone's sub-pages: no request for what is not shown
  return getCached(BOARD_PATH).then(patchBoard, (err) => {
    boardStatus.textContent = `SIGNAL LOST · ${err.message} · retrying within a minute`;
  });
}

function markCurrentBounty() {
  const current = (location.hash.match(/^#\/b\/[^/]+/) || [])[0];
  for (const row of boardRows.children) {
    if (row.hash === current) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
  }
}

/** Hyperscript: h('a.row', { href }, ...children). API text only ever lands in text nodes. */
export function h(tag, attrs, ...kids) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  if (attrs != null && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) kids.unshift(attrs);
  else for (const k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}

/** Write a text node only when its value changed, flashing a live value that moved. */
export function setText(el, value) {
  value = String(value);
  const old = el.textContent;
  if (old === value) return;
  if (old && old !== '—') {
    el.classList.remove('fx');
    requestAnimationFrame(() => el.classList.add('fx'));
  }
  el.textContent = value;
}

/** A surface's own styles, added the first time its module loads: the shell carries none of them. */
export function addStyles(css) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  document.adoptedStyleSheets.push(sheet);
}

/** T-minus text of a deadline, or '' once it has passed. */
export function countdown(deadline) {
  const s = Math.floor((Date.parse(deadline) - Date.now()) / 1000);
  if (!(s > 0)) return '';
  const two = (n) => String(Math.floor(n)).padStart(2, '0');
  return `T-${s >= 86400 ? Math.floor(s / 86400) + 'd ' : ''}${two((s % 86400) / 3600)}:${two((s % 3600) / 60)}:${two(s % 60)}`;
}

/** A live countdown element; the one ticker keeps every such element on the page current. */
export function countdownTimer(deadline, closed = 'CLOSED') {
  return h('time.t', { 'data-t': deadline, 'data-z': closed }, countdown(deadline) || closed);
}

/** The breadcrumb and the two tabs a bounty's page and its leaderboard share. */
export function bountyTabs(slug, onLeaderboard) {
  const base = '#/b/' + encodeURIComponent(slug);
  return [
    h('p.dim', h('a', { href: '#/' }, 'BOARD'), ' / ', slug),
    h('nav.tabs',
      h('a', { href: base, 'aria-current': onLeaderboard ? null : 'page' }, 'BRIEFING'),
      h('a', { href: base + '/leaderboard', 'aria-current': onLeaderboard ? 'page' : null }, 'LEADERBOARD')),
  ];
}

function showNet() {
  netReadout.textContent = `NET ${net.req} req · ${net.notModified} unchanged · ${net.memory} cached`;
}

export const usd = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) : '—';
};
export const count = (n) => (Number(n) || 0).toLocaleString('en-US');
export const utc = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : '—');
export const isLive = (deadline) => Date.parse(deadline) > Date.now();
export const origin = (path) => (path && path[0] === '/' ? API.slice(0, -4) + path : path);

/** A leaderboard value as people read it: a win rate in millionths becomes a percentage. */
export const score = (column, value, display) =>
  value == null ? '—' : /micro/.test(column?.source) ? (value / 1e4).toFixed(1) + '%' : display ?? String(value);

const FRESH_MS = 30_000; // inside this window a path costs no request at all
const SYNC_MS = 60_000; // make.fun's ETags turn with the minute, so revalidate once a minute
const inflight = new Map(); // path -> the one shared request
const net = { req: 0, notModified: 0, memory: 0 };
const potOf = (b) => Number(b.potUsd ?? b.rewardAmount) || 0;
const BOARD_SORTS = {
  pot: (a, b) => potOf(b) - potOf(a),
  t: (a, b) => Date.parse(a.deadline) - Date.parse(b.deadline),
  ent: (a, b) => b.submissionCount - a.submissionCount,
};
const $ = (selector) => document.querySelector(selector);
const [board, view, boardRows, boardStatus, boardFilter, netReadout, clock] = ['#board', '#view', '.rows', '.st', '.ctl input', '#net', '.clock'].map($);
const [hudLive, hudPot, hudEntries, hudNext] = [...document.querySelectorAll('.hud>div')].map((tile) => tile.lastElementChild);
const timers = document.getElementsByClassName('t'); // a live collection: never queried again
let boardData = null;
let boardSort = 'pot';
let visit = 0; // a slow answer never paints over a newer navigation
let liveView = null; // { path, patch, data } of the surface in <main>
let syncedAt = Date.now();

// The board's rows, the split layout and what every sub-surface shares; each view adds its own.
addStyles(`
a:hover{text-decoration:underline}
h1{font-size:20px;line-height:1.25;margin:6px 0 10px}
h2{font-size:12px;letter-spacing:.12em;color:var(--dim);margin:20px 0 8px;text-transform:uppercase}
p{margin:0 0 10px}
.sub #board,body:not(.sub) #view{display:none}
.hud i{display:block;font-style:normal;font-size:12px;color:var(--dim)}
.t.hot{color:var(--hot)}
.t.over{color:var(--dim)}
.row{display:grid;grid-template:"n n" "p t" "f e"/1fr auto;gap:1px 12px;align-items:baseline;padding:9px 10px;border-bottom:1px solid var(--line);color:var(--ink)}
.row:hover,.row[aria-current]{background:var(--panel);text-decoration:none}
.row[aria-current]{box-shadow:inset 3px 0 var(--go)}
.name{grid-area:n;min-width:0}
.name b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.name b::before{content:"● ";color:var(--go)}
.off .name b::before,.off .pot{color:var(--dim)}
.name i,.dim{font-style:normal;font-size:12px;color:var(--dim)}
.pot{grid-area:p;font-weight:700;font-size:16px;color:var(--go)}
.fee{grid-area:f}
.row .t{grid-area:t;text-align:right}
.ent{grid-area:e;text-align:right}
.fee,.ent{color:var(--dim);font-size:12px}
.st,.wait{padding:10px 0}
.wait{color:var(--dim)}
.err{color:var(--hot)}
.fx{animation:fx 1.2s}
@keyframes fx{from{background:var(--go);color:var(--bg)}}
@media(min-width:960px){
.sub .deck{display:grid;grid-template-columns:330px minmax(0,1fr)}
.sub #board{display:block;position:sticky;top:42px;height:calc(100vh - 42px);overflow-y:auto;border-right:1px solid var(--line)}
.sub #board .hud{grid-template-columns:repeat(2,1fr)}
.sub #board .hud b,.sub #board .hud time{font-size:16px}
.sub #board button{padding:5px 4px;font-size:12px}
#view{padding:14px 20px}
body:not(.sub) #board input{flex:1}
body:not(.sub) #board button{flex:none}
body:not(.sub) .cols{display:grid;padding:6px 10px;border-bottom:1px solid var(--line);color:var(--dim);font-size:11px;letter-spacing:.1em}
body:not(.sub) .row{grid-template:"n p f t e"/minmax(0,1fr) 110px 110px 150px 130px}
body:not(.sub) .cols{grid-template-columns:minmax(0,1fr) 110px 110px 150px 130px;gap:12px}
body:not(.sub) .row>:not(.name){text-align:right;font-size:14px}
.cols>:not(:first-child){text-align:right}
body:not(.sub) .row>.pot{font-size:16px}
}
h3{font-size:14px;margin:16px 0 4px;color:var(--go)}
code{color:var(--warn)}
.tabs{display:flex;gap:6px;margin:0 0 12px;border-bottom:1px solid var(--line)}
.tabs a{padding:7px 12px;color:var(--dim);border:1px solid var(--line);border-bottom:0}
.tabs a[aria-current]{color:var(--bg);background:var(--go);border-color:var(--go)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:11px;letter-spacing:.1em;color:var(--dim);font-weight:400}
th:first-child,td:first-child,.wrap td{text-align:left;white-space:normal}
.wrap td:last-child{text-align:right}
`);

boardFilter.addEventListener('input', () => boardData && patchBoard(boardData, true));
$('.ctl').addEventListener('click', (event) => {
  const key = event.target.dataset.s;
  if (!key) return;
  boardSort = key;
  for (const button of event.currentTarget.querySelectorAll('button')) button.setAttribute('aria-pressed', button === event.target);
  if (boardData) patchBoard(boardData, true);
});
addEventListener('hashchange', routeTo);
setInterval(tickCountdowns, 1000);
tickCountdowns();
routeTo();
