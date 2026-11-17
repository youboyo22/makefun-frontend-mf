// Surface 4: an account's public profile. One request: who they are, their record, every entry
// they have made (each linking back to its bounty and leaderboard) and the prizes paid to them.

import { h, setText, patchRows, addStyles, usd, count, utc, score, origin } from './app.js';

export const path = (handle) => `/profiles/${encodeURIComponent(handle)}`;

addStyles(`
.who{display:flex;gap:14px;align-items:center;margin-bottom:12px}
.who img{width:72px;height:72px;border:1px solid var(--go);background:var(--panel);object-fit:cover}
`);

const bountyLink = (c) => h('a', { href: '#/b/' + encodeURIComponent(c.slug) }, c.title || c.slug);

export function mount(view, handle, first) {
  const name = h('h1');
  const about = h('p');
  const links = h('p');
  const avatar = h('img', { alt: '', width: 72, height: 72, crossorigin: 'anonymous' });
  const tiles = ['Entered', 'Placed', 'Won', 'Winnings'].map((label) => h('div', h('small', label), h('b'), h('i')));
  const entries = h('tbody');
  const entriesHead = h('h2');
  const payouts = h('tbody');
  const payoutsHead = h('h2');

  view.replaceChildren(
    h('p.dim', h('a', { href: '#/' }, 'BOARD'), ' / PROFILE / ', handle),
    h('div.who', avatar, h('div', name, about, links)),
    h('div.hud', tiles),
    entriesHead,
    h('table', h('thead', h('tr', h('th', 'ENTRY'), h('th', 'SCORE'), h('th', 'PLACE'), h('th', 'PRIZE'))), entries),
    payoutsHead,
    h('table', payouts),
  );

  function patch(p) {
    const record = p.record ?? {};
    const solutions = p.solutions ?? [];
    const paid = p.payouts ?? [];
    document.title = `@${p.handle} · MISSION CONTROL`;
    setText(name, p.display_name || `@${p.handle}`);
    setText(about, [p.display_name && `@${p.handle}`, p.bio, p.house && 'HOUSE ACCOUNT', p.joined_at && `joined ${p.joined_at.slice(0, 10)}`].filter(Boolean).join(' · '));
    const image = origin(p.avatar?.url ?? p.image);
    if (image && avatar.src !== image) avatar.src = image;
    links.replaceChildren(...[
      p.github_login && h('a', { href: `https://github.com/${encodeURIComponent(p.github_login)}`, rel: 'noopener' }, 'GitHub ↗ '),
      p.x && h('a', { href: `https://x.com/${encodeURIComponent(p.x)}`, rel: 'noopener' }, 'X ↗ '),
      p.wallet?.explorer_url && h('a', { href: p.wallet.explorer_url, rel: 'noopener' }, 'Wallet ↗'),
    ].filter(Boolean));

    const figures = [
      [count(record.competitions_entered), 'bounties'],
      [count(record.competitions_placed), record.best_placement ? `best finish #${record.best_placement}` : 'no placement yet'],
      [count(record.competitions_won), `${count(record.podium_finishes)} podiums`],
      [usd(record.prize_usd ?? 0), `${paid.length} payouts`],
    ];
    tiles.forEach((tile, i) => {
      setText(tile.children[1], figures[i][0]);
      setText(tile.children[2], figures[i][1]);
    });

    setText(entriesHead, `Entries · ${solutions.length}`);
    patchRows(entries, solutions, (s) => s.submission_id,
      (s) => h('tr', h('td', s.title || 'Untitled entry', h('span.dim', ' · ', bountyLink(s.competition ?? {}))), h('td.g'), h('td'), h('td.g')),
      (tr, s) => {
        setText(tr.children[1], s.score ? score(s.score.column, s.score.value, s.score.display) : '—');
        setText(tr.children[2], s.placement ? `#${s.placement}` : '—');
        setText(tr.children[3], Number(s.prize_usd) ? usd(s.prize_usd) : '—');
      });

    setText(payoutsHead, paid.length ? `Payouts · ${paid.length}` : '');
    patchRows(payouts, paid, (x) => x.id,
      (x) => h('tr',
        h('td', bountyLink(x.competition ?? {})),
        h('td', x.place ? `#${x.place}` : ''),
        h('td.g', usd(x.amount_usd)),
        h('td', x.explorer_url ? h('a', { href: x.explorer_url, rel: 'noopener' }, `${utc(x.paid_at)} ↗`) : utc(x.paid_at))),
      () => {});
  }
  patch(first);
  return patch;
}
