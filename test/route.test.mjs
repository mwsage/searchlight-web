/**
 * Exercise the REAL script out of index.html against a minimal DOM stub, for each
 * path that matters, plus the static properties of the standalone pages.
 *
 * Deliberately not a snapshot. It checks the things that would be a privacy or trust
 * failure if they broke: invite paths staying `noindex`, the home path never touching
 * the network, a mangled invite still meeting the invite error rather than the welcome
 * page, and both beta calls-to-action resolving together.
 */
import { readFileSync } from 'node:fs';

const url = (p) => new URL(p, import.meta.url);
const html = readFileSync(url('../public/index.html'), 'utf8');
const privacy = readFileSync(url('../public/privacy/index.html'), 'utf8');
const support = readFileSync(url('../public/support/index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const SECTIONS = ['home', 'loading', 'invite', 'invalid', 'event'];
const IDS = [...SECTIONS, 'joinBeta', 'betaSoon', 'joinBetaMid', 'betaSoonMid', 'joinBetaFoot', 'betaSoonFoot',
             'brandLine', 'install', 'open', 'installFallback',
             'eventInstall', 'eventOpen',
             'inviter', 'groupName', 'groupDesc', 'visibility'];

function run(pathname) {
  const els = {};
  for (const id of IDS) els[id] = { id, hidden: id !== 'loading', href: '', textContent: '' };
  const robots = { content: 'noindex, nofollow', setAttribute(k, v) { this[k] = v; } };
  const foot = { hidden: false };
  const body = { className: '' };

  const document = {
    body,
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
           bodyClass: body.className,
           eventOpen: els.eventOpen.href,
           joins: [els.joinBeta, els.joinBetaMid, els.joinBetaFoot].map((e) => (e.hidden ? null : e.href)),
           soons: [els.betaSoon, els.betaSoonMid, els.betaSoonFoot].map((e) => !e.hidden) };
}

let failed = 0;
const assert = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failed++;
};

console.log('--- routing ---');
for (const [path, expect] of [
  ['/',            'home'],
  ['/about',       'home'],
  ['/i',           'home'],      // not an invite attempt — no trailing slash
  ['/i/',          'invalid'],   // an invite attempt with no id
  ['/i/BAD ID',    'invalid'],
  ['/i/abc123',    'loading'],   // invite path: fetch fires, view resolves async
  ['/e',           'home'],
  ['/e/',          'invalid'],
  ['/e/ev_abc123', 'event'],
]) {
  const r = run(path);
  const got = r.visible.length === 1 ? r.visible[0] : `[${r.visible}]`;
  assert(`${path.padEnd(12)} → ${got.padEnd(8)} robots=${r.robots}`, got === expect);
}

console.log('\n--- indexing (the privacy-critical half) ---');
const homeR = run('/');
const inviteR = run('/i/abc123');
assert('welcome page is indexable', homeR.robots === 'index, follow');
assert('INVITE path stays noindex', inviteR.robots === 'noindex, nofollow');
assert('invalid-invite path stays noindex', run('/i/').robots === 'noindex, nofollow');
assert('privacy page is indexable', /content="index, follow"/.test(privacy));
assert('support page is indexable', /content="index, follow"/.test(support));

console.log('\n--- welcome page behaviour ---');
assert('home never fetches', homeR.fetched === null);
assert('invite path does fetch', inviteR.fetched !== null);
const eventR = run('/e/ev_abc123');
assert('event path never fetches', eventR.fetched === null);
assert('event path stays noindex', eventR.robots === 'noindex, nofollow');
assert('event open uses the app scheme',
       eventR.eventOpen === 'searchlight:///event/ev_abc123');
assert('home swaps body to the scrolling layout', homeR.bodyClass === 'is-home');
assert('invite path leaves the centred layout alone', inviteR.bodyClass === '');
assert('BOTH beta CTAs resolve together — never one live and one dead',
       homeR.joins[0] === homeR.joins[1] && homeR.soons[0] === homeR.soons[1]);
assert('beta buttons hidden while the link is unset',
       homeR.joins.every((j) => j === null) && homeR.soons.every(Boolean));

console.log('\n--- copy ---');
assert('no "waitlist" anywhere — the beta is a public link', !/waitlist/i.test(html));
// The founder de-gendered this copy deliberately; a regression here is a values
// regression rather than a typo, so it is pinned instead of left to review.
for (const phrase of ['for men', 'the guy', 'guys', ' his ', ' him ']) {
  assert(`no gendered phrasing: ${JSON.stringify(phrase)}`,
         !html.toLowerCase().includes(phrase));
}
assert('support address appears on both standalone pages',
       privacy.includes('support@searchlight.social') &&
       support.includes('support@searchlight.social'));
assert('welcome page links to privacy and support',
       html.includes('href="/privacy"') && html.includes('href="/support"'));

process.exit(failed ? 1 : 0);
