/**
 * Exercise the REAL script out of index.html against a minimal DOM stub, for each
 * path that matters. Static string checks proved the markup exists; this proves the
 * routing actually reaches it.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Ids the page addresses, plus the sections show() toggles.
const SECTIONS = ['home', 'loading', 'invite', 'invalid'];
const IDS = [...SECTIONS, 'joinBeta', 'betaSoon', 'install', 'open', 'installFallback',
             'inviter', 'groupName', 'groupDesc', 'visibility'];

function run(pathname) {
  const els = {};
  for (const id of IDS) els[id] = { id, hidden: id !== 'loading', href: '', textContent: '' };
  const robots = { content: 'noindex, nofollow',
                   setAttribute(k, v) { this[k] = v; } };
  const foot = { hidden: false };

  const document = {
    getElementById: (id) => els[id],
    querySelector: (sel) => (sel === '.foot' ? foot
                           : sel === 'meta[name="robots"]' ? robots : null),
  };
  const window = { location: { pathname } };
  let fetched = null;
  const fetch = (u) => { fetched = u; return { then: () => ({ then: () => ({ catch: () => {} }) }) }; };

  new Function('window', 'document', 'fetch', script)(window, document, fetch);

  const visible = SECTIONS.filter((s) => !els[s].hidden);
  return { visible, robots: robots.content, footHidden: foot.hidden, fetched,
           join: els.joinBeta.hidden ? null : els.joinBeta.href,
           soonShown: !els.betaSoon.hidden };
}

const cases = [
  ['/',                     'home'],
  ['/about',                'home'],
  ['/i',                    'home'],     // not an invite attempt — no trailing slash
  ['/i/',                   'invalid'],  // an invite attempt with no id
  ['/i/BAD ID',             'invalid'],
  ['/i/abc123',             null],       // invite path: fetch fires, view set async
];

let failed = 0;
for (const [path, expect] of cases) {
  const r = run(path);
  const got = r.visible.length === 1 ? r.visible[0] : `[${r.visible}]`;
  const ok = expect === null ? (r.fetched !== null) : (got === expect);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${path.padEnd(12)} → ${got.padEnd(8)} robots=${r.robots.padEnd(15)} fetch=${r.fetched ? 'yes' : 'no'}`);
}

// The two properties that would be privacy or trust failures if wrong.
const homeR = run('/');
const inviteR = run('/i/abc123');
const assert = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failed++; };
assert('home is indexable', homeR.robots === 'index, follow');
assert('INVITE PATH STAYS noindex', inviteR.robots === 'noindex, nofollow');
assert('invalid path stays noindex', run('/i/').robots === 'noindex, nofollow');
assert('home never fetches', homeR.fetched === null);
assert('beta button hidden while link unset', homeR.join === null && homeR.soonShown);

process.exit(failed ? 1 : 0);
