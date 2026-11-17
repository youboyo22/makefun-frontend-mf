// Surface 2: a bounty's briefing. One request (submissions=summary keeps the answer small): the
// live pot, the entry fee, the countdown, the rewards table, the dates, the description and the
// rules. The rules are long, so they are rendered only when their panel is opened.

import { h, setText, patchRows, addStyles, usd, count, utc, isLive, countdownTimer, bountyTabs } from './app.js';

export const path = (slug) => `/competitions/${encodeURIComponent(slug)}?submissions=summary`;

addStyles(`
.chip{display:inline-block;padding:1px 8px;border:1px solid;color:var(--go);font-size:12px;margin-right:8px}
.chip.w{color:var(--warn)}
.chip.d{color:var(--dim)}
.two{display:grid;grid-template-columns:minmax(0,1fr);gap:0 24px}
details{border:1px solid var(--line);margin-top:10px}
summary{cursor:pointer;padding:8px 10px;background:var(--panel);color:var(--go)}
.md{padding:4px 12px 10px;overflow-wrap:anywhere;max-width:92ch}
.md ul{margin:0 0 10px;padding-left:20px}
@media(min-width:960px){.two{grid-template-columns:1fr 1fr}}
`);

/** Places paying the same amount share one row: "4–10 · $20 each". */
function rewardRows(b) {
  const places = b.rewardsNow?.length
    ? b.rewardsNow.map((r) => ({ place: r.place, base: r.baseUsd, fees: r.feeShareUsd, now: r.amountUsd }))
    : Object.entries(b.rewards ?? {}).map(([place, amount]) => ({ place: Number(place), base: amount, fees: 0, now: amount }));
  const rows = [];
  for (const p of places) {
    const last = rows[rows.length - 1];
    if (last && last.now === p.now && last.to === p.place - 1) last.to = p.place;
    else rows.push({ ...p, to: p.place });
  }
  return rows;
}

function statusChip(b) {
  if (b.status !== 'open') return h('span.chip.d', String(b.status).toUpperCase());
  return isLive(b.deadline) ? h('span.chip', '● LIVE · TAKING ENTRIES') : h('span.chip.w', '◌ ENTRIES CLOSED · JUDGING');
}

/** Small Markdown: headings, bullet lists, paragraphs, `code`, **bold** and links, as DOM nodes. */
export function renderMarkdown(text) {
  const out = h('div.md');
  let list = null;
  for (const line of String(text ?? '').split('\n')) {
    const bullet = line.match(/^\s*[-*] (.*)/);
    if (bullet) {
      if (!list) out.append((list = h('ul')));
      list.append(h('li', inline(bullet[1])));
      continue;
    }
    list = null;
    const heading = line.match(/^#+ (.*)/);
    if (heading) out.append(h('h3', heading[1]));
    else if (line.trim()) out.append(h('p', inline(line)));
  }
  return out;
}

function inline(text) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/).map((part) => {
    if (part[0] === '`') return h('code', part.slice(1, -1));
    if (part.startsWith('**')) return h('b', part.slice(2, -2));
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+|\/[^)]*)\)$/);
    if (link) return h('a', { href: link[2][0] === '/' ? 'https://make.fun' + link[2] : link[2], rel: 'noopener' }, link[1]);
    return part;
  });
}

export function mount(view, slug, b) {
  document.title = `${b.title} · MISSION CONTROL`;
  const pot = h('b.g');
  const potNote = h('i');
  const fee = h('b');
  const feeNote = h('i');
  const entries = h('b');
  const entriesNote = h('i');
  const status = h('span');
  const rewards = h('tbody');

  const rules = h('details', h('summary', `RULES · ${count(Math.ceil((b.rules ?? '').length / 1024))} KB · open to read`));
  rules.addEventListener('toggle', () => rules.children.length < 2 && rules.append(renderMarkdown(b.rules)), { once: true });

  const dates = [
    ['Opens', b.opensAt ?? b.publishedAt],
    ...(b.phases ?? []).map((p) => [`${p.title} phase`, p.startsAt, p.endsAt]),
    ['Entries close', b.deadline],
    ['Resolved', b.resolvedAt],
  ].filter((d) => d[1]);

  view.replaceChildren(
    ...bountyTabs(slug, false),
    h('h1', b.title),
    h('p', status, h('span.dim', [b.category, b.sponsor?.name && `by ${b.sponsor.name}`, b.harnessKind].filter(Boolean).join(' · '))),
    h('div.hud',
      h('div', h('small', 'Live pot'), pot, potNote),
      h('div', h('small', 'Entry fee'), fee, feeNote),
      h('div', h('small', 'Time left'), countdownTimer(b.deadline, b.status === 'open' ? 'JUDGING' : 'RESOLVED'), h('i', utc(b.deadline))),
      h('div', h('small', 'Entries'), entries, entriesNote)),
    h('p', b.summary),
    h('div.two',
      h('section', h('h2', 'Rewards · live pot split'),
        h('table', h('thead', h('tr', h('th', 'PLACE'), h('th', 'BASE'), h('th', '+ FEES'), h('th', 'PAYS NOW'))), rewards)),
      h('section', h('h2', 'Dates · UTC'),
        h('table.wrap', h('tbody', dates.map(([label, from, to]) => h('tr', h('td', label), h('td', utc(from) + (to ? ` → ${utc(to)}` : ''))))))),
    ),
    h('h2', 'Briefing'),
    h('details', { open: '' }, h('summary', 'DESCRIPTION'), renderMarkdown(b.description)),
    b.rules && rules,
    b.resolution?.summary && h('details', h('summary', 'HOW IT IS JUDGED'), renderMarkdown(b.resolution.summary)),
  );

  /** The live figures, patched in place each time the bounty is revalidated. */
  function patch(now) {
    status.replaceChildren(statusChip(now));
    setText(pot, usd(now.potUsd ?? now.rewardAmount));
    setText(potNote, now.entryFeesUsd ? `${usd(now.rewardAmount)} base + ${usd(now.entryFeesUsd)} fees` : 'paid by the sponsor');
    setText(fee, now.entryFeeUsd ? usd(now.entryFeeUsd) : 'FREE');
    setText(feeNote, now.entryFeeUsd ? `once per account · ${count(now.entryFeePayers)} paid` : 'no fee to enter');
    setText(entries, count(now.submissionCount));
    setText(entriesNote, now.submissionsPassed == null ? 'submitted' : `${count(now.submissionsPassed)} passed the gate`);
    patchRows(rewards, rewardRows(now), (r) => r.place,
      () => h('tr', h('td'), h('td'), h('td'), h('td.g')),
      (tr, r) => {
        const [place, base, fees, pays] = tr.children;
        setText(place, r.to > r.place ? `#${r.place}–${r.to} each` : `#${r.place}`);
        setText(base, usd(r.base));
        setText(fees, Number(r.fees) ? `+${usd(r.fees)}` : '—');
        setText(pays, usd(r.now));
      });
  }
  patch(b);
  return patch;
}
