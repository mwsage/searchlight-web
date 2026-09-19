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
const terms = readFileSync(url('../public/terms/index.html'), 'utf8');
const aasa = JSON.parse(readFileSync(url('../public/.well-known/apple-app-site-association'), 'utf8'));
const robots = readFileSync(url('../public/robots.txt'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const SECTIONS = ['home', 'loading', 'invite', 'invalid', 'event'];
const APP_STORE_URL = 'https://apps.apple.com/us/app/searchlight-social/id6762578884';
const IDS = [...SECTIONS, 'getApp', 'getAppSoon', 'getAppMid', 'getAppSoonMid', 'getAppFoot', 'getAppSoonFoot',
             'brandLine', 'install', 'open', 'installFallback', 'afterInstall',
             'eventInstall', 'eventOpen',
             'inviter', 'groupName', 'groupDesc', 'visibility'];

/**
 * `invite` — a groupInvitePreviews document for the fetch to resolve with. Omitted, the
 * fetch stub never calls back, which is what every pre-existing case relies on: they
 * assert the LOADING state and must not run the resolution body.
 */
function run(pathname, invite) {
  const els = {};
  for (const id of IDS) {
    els[id] = {
      id, hidden: id !== 'loading', href: '', textContent: '',
      listeners: {},
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
      click() { for (const fn of this.listeners.click ?? []) fn(); },
    };
  }
  const robots = { content: 'noindex, nofollow', setAttribute(k, v) { this[k] = v; } };
  const foot = { hidden: false };
  const body = { className: '' };

  const document = {
    body,
    getElementById: (id) => els[id],
    querySelector: (sel) => (sel === '.foot' ? foot
                           : sel === 'meta[name="robots"]' ? robots : null),
  };
  const window = { location: { pathname, href: `https://searchlight.social${pathname}` } };
  let fetched = null;
  const copied = [];
  const navigator = { clipboard: { writeText: (t) => { copied.push(t); } } };

  // Resolves SYNCHRONOUSLY through a thenable, so the assertions below need no await
  // and the pre-existing cases keep the never-resolving stub they were written against.
  const resolved = (value) => ({
    then: (onOk) => { const next = onOk ? onOk(value) : value; return resolved(next); },
    catch: () => resolved(value),
  });
  const fetch = (u) => {
    fetched = u;
    if (!invite) return { then: () => ({ then: () => ({ catch: () => {} }) }) };
    return resolved({ ok: true, json: () => invite });
  };

  new Function('window', 'document', 'fetch', 'navigator', script)(window, document, fetch, navigator);

  const visible = SECTIONS.filter((s) => !els[s].hidden);
  return { visible, robots: robots.content, footHidden: foot.hidden, fetched, els, copied,
           bodyClass: body.className,
           eventOpen: els.eventOpen.href,
           joins: [els.getApp, els.getAppMid, els.getAppFoot].map((e) => (e.hidden ? null : e.href)),
           soons: [els.getAppSoon, els.getAppSoonMid, els.getAppSoonFoot].map((e) => !e.hidden) };
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
assert('terms page is indexable', /content="index, follow"/.test(terms));

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
assert('ALL THREE install CTAs resolve together — never one live and one dead',
       homeR.joins[0] === homeR.joins[1] && homeR.joins[1] === homeR.joins[2] &&
       homeR.soons[0] === homeR.soons[1] && homeR.soons[1] === homeR.soons[2]);
// LAUNCHED 2026-09-18. This pair used to assert the opposite — buttons hidden, stand-in
// shown — which was right while INSTALL_URL was Apple's generic TestFlight page. The
// app is live, so the contract inverted and the test inverts with it.
assert('every install button is live and points at the App Store listing',
       homeR.joins.every((j) => j === APP_STORE_URL));
assert('the "not yet" stand-in never renders once the link is real',
       homeR.soons.every((shown) => shown === false));
assert('the install link is the real listing, with the numeric app id',
       /^https:\/\/apps\.apple\.com\/[a-z]{2}\/app\/[a-z0-9-]+\/id\d+$/.test(APP_STORE_URL));
assert('no TestFlight link survives anywhere on the page',
       !/testflight\.apple\.com/i.test(html));

console.log('\n--- markup ---');
// 88 copy assertions passed over `<p><hr>…</p></h4></p>` and `<li><h4>…</h4><li><br>`.
// Every one of them reads TEXT, so none could see that the tags around it were invalid —
// and a browser silently reflows broken nesting into something that renders wrong rather
// than failing. These check the shape instead of the words.
for (const [tag, n] of [['p', 'p'], ['li', 'li'], ['h4', 'h4'], ['h3', 'h3'], ['ul', 'ul']]) {
  const open = (html.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
  const close = (html.match(new RegExp(`</${n}>`, 'g')) || []).length;
  assert(`<${tag}> tags balance (${open} open / ${close} close)`, open === close);
}
// A <p> cannot contain flow content. The browser closes the paragraph at the block tag,
// so the author's intended grouping silently disappears.
for (const block of ['hr', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'div', 'p']) {
  assert(`no <${block}> nested directly inside a <p>`,
         !new RegExp(`<p[^>]*>\\s*<${block}[ >/]`).test(html));
}
// REMOVED 2026-09-19: 'no heading nested inside a list item'. It forbade valid HTML —
// <li> accepts flow content, headings included — and it was blocking the correct fix for
// `<h4><li>…</li></h4>`, which really was invalid. It was written against
// `<li><h4>…</h4><li><br>`, where the actual defect was the unclosed <li>; the <li> tag
// balance check above catches that (2 open / 1 close) and is the one doing the work.

console.log('\n--- copy ---');
assert('no "Join the beta" copy survives the launch', !/join the beta/i.test(html));
// COLD START. "How it works" shipped as create -> signal -> notified, which silently
// assumed the group already had people in it. At launch there are no users at all, so
// the step that was missing is the only one an early adopter actually has to do.
const steps = (html.match(/<h2>How it works<\/h2>[\s\S]*?<\/ol>/) || [''])[0];
const stepNums = [...steps.matchAll(/<span class="n">(\d)<\/span>/g)].map((m) => m[1]);
const stepHeads = [...steps.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
assert('How it works is numbered 1..4 with no gap', stepNums.join('') === '1234');
assert('the invite step exists and sits before the signal step',
       stepHeads[1] === 'Bring your people' && stepHeads[2] === 'Throw up a Searchlight');
assert('the invite step tells them to text a link', /text it to them/i.test(steps));
// TWO ASSERTIONS RETIRED HERE 2026-09-19, and the reason is recorded so nobody
// restores them from the git history as a "fix".
//
// They pinned a standalone block — "Nobody you know is on Searchlight yet" / "no feed,
// no discovery" — added in ad3bfb1 and deleted the next commit, 1ffb11e, in the
// founder's copy pass. The COPY DECISION STANDS: the shorter page is the one we want.
//
// Nothing was lost, which is why this is a retirement and not a regression. The block
// existed to say that an early adopter has nobody to find and has to bring their own
// people, and step 2 now says that INSIDE the step it applies to, which is the better
// place for it. The line below pins that, so the meaning is still guarded after its
// original wording is gone.
//
// This was red on main for a day, unseen, because this repo has no CI. Nothing runs
// this file except a person remembering to.
assert('the invite step still says there is nothing to search for — no discovery to rely on',
       /Nothing to search for/i.test(steps));
assert('no "waitlist" anywhere — the beta is a public link', !/waitlist/i.test(html));
// The founder de-gendered this copy deliberately; a regression here is a values
// regression rather than a typo, so it is pinned instead of left to review.
for (const phrase of ['for men', 'the guy', 'guys', ' his ', ' him ']) {
  assert(`no gendered phrasing: ${JSON.stringify(phrase)}`,
         !html.toLowerCase().includes(phrase));
}
assert('support address appears on every standalone page',
       privacy.includes('support@searchlight.social') &&
       support.includes('support@searchlight.social') &&
       terms.includes('support@searchlight.social'));
assert('welcome page links to privacy, terms and support',
       html.includes('href="/privacy"') && html.includes('href="/terms"') &&
       html.includes('href="/support"'));

// Universal links. This file is the ONLY thing that decides whether a tapped
// searchlight.social/i/... opens the app or the website, and it fails silently:
// a missing appID does not error anywhere, the link just opens Safari. It went
// unnoticed for the whole life of Searchlight Dev, which could never test a link
// flow because only the production bundle id was listed.
const APP_IDS = aasa.applinks.details[0].appIDs;
const PATHS = aasa.applinks.details[0].components.map((c) => c['/']);

assert('AASA claims the production app id',
       APP_IDS.includes('76AW6N85V6.com.searchlight.app'));
assert('AASA claims the DEV app id, so links are testable before they ship',
       APP_IDS.includes('76AW6N85V6.com.searchlight.app.dev'));
assert('every AASA app id carries the team prefix',
       APP_IDS.every((id) => id.startsWith('76AW6N85V6.')));
assert('AASA app ids are unique',
       new Set(APP_IDS).size === APP_IDS.length);
// The two link shapes the app actually mints (groupDeepLink / event share).
assert('AASA claims the invite path', PATHS.includes('/i/*'));
assert('AASA claims the event path', PATHS.includes('/e/*'));
// A bare "*" would hand every page on the domain to the app, including /privacy
// and /support — the two URLs App Review opens in a browser.
assert('AASA does not claim the whole domain',
       !PATHS.includes('*') && !PATHS.includes('/*'));

// robots.txt. It has to be a real FILE: an exact-match asset beats the SPA
// fallback (the same reason /privacy and /support are their own files), and
// without one this path served the home page as if it were a robots policy.
const directives = robots.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
const has = (line) => directives.some((d) => d.trim() === line);

assert('robots.txt is directives, not the fallback page',
       !robots.includes('<!DOCTYPE') && !robots.includes('<html'));
assert('robots.txt applies to every crawler', has('User-agent: *'));
// Unlisted links. A crawler walking these would put group names in search results.
assert('invite links are disallowed', has('Disallow: /i/'));
assert('event links are disallowed', has('Disallow: /e/'));
// Every unknown path returns 200 here, so the catch-all is what stops a crawler
// walking probe paths forever.
assert('everything else is disallowed by default', has('Disallow: /'));
// The three pages that ARE public — /privacy and /support are App Store fields.
assert('the home page is allowed', has('Allow: /$'));
assert('the privacy page is allowed', has('Allow: /privacy'));
assert('the terms page is allowed', has('Allow: /terms'));
assert('the support page is allowed', has('Allow: /support'));
// The allow-list must not accidentally re-open the unlisted paths.
assert('no Allow rule re-opens an unlisted link',
       !directives.some((d) => /^Allow:\s*\/(i|e)\//.test(d.trim())));
// EXACTLY ONE wildcard group. Cloudflare's managed block was a second
// `User-agent: *` carrying `Allow: /`, which cancelled the catch-all above —
// merging crawlers break a tie toward the least restrictive rule, and
// first-match crawlers never reach the second group at all.
assert('there is exactly one User-agent: * group',
       directives.filter((d) => d.trim() === 'User-agent: *').length === 1);
// The AI-crawler blocks Cloudflare used to supply, now versioned here instead of
// living in a dashboard toggle nothing can test.
for (const bot of ['Amazonbot', 'Applebot-Extended', 'Bytespider', 'CCBot',
                   'ClaudeBot', 'Google-Extended', 'GPTBot', 'meta-externalagent']) {
  assert(`${bot} is disallowed`, has(`User-agent: ${bot}`));
}
// A named group whose next line is not `Disallow: /` blocks nothing — the bot
// matches its own group, finds no rule, and crawls freely.
for (let i = 0; i < directives.length; i++) {
  const line = directives[i].trim();
  if (line.startsWith('User-agent: ') && line !== 'User-agent: *') {
    assert(`${line} is followed by a rule that blocks it`,
           (directives[i + 1] || '').trim() === 'Disallow: /');
  }
}
assert('the content signal permits search and refuses training',
       /^Content-Signal:.*search=yes/m.test(robots) && /ai-train=no/.test(robots));

// PRIVACY POLICY: two claims a reader can falsify.
// A legal document must not promise a mechanism the app does not have, and it
// must not need the product's vocabulary to be understood — App Review opens
// this URL in a browser, having never used the app.
assert('no promise of in-app change notices — there is no such surface',
       !/surfaced in the app/i.test(privacy) && !/notify you in the app/i.test(privacy));
assert('the policy says how a reader detects a change instead',
       /date at the top\s*\n?\s*is updated/i.test(privacy) || /Check the date above/i.test(privacy));
assert('no "throws up a Searchlight" jargon anywhere on the page',
       !/throws? up a Searchlight/i.test(privacy));

// TERMS OF USE — the Guideline 1.2 clauses, pinned.
// App Review rejected Searchlight because there was no EULA the user agrees to. This
// page is that EULA, and the four things below are what the guideline names by hand:
// the no-tolerance statement, a stated way to flag content, a stated way to block a
// user, and a stated timeframe for acting on a report. Losing any one of them in an
// edit would cost another review cycle, and nothing else in this repo would notice.
console.log('\n--- terms of use (Guideline 1.2) ---');
assert('states no tolerance for objectionable content',
       /no tolerance for objectionable content/i.test(terms));
assert('states no tolerance for abusive behaviour',
       /no tolerance for objectionable content or for abusive behaviour/i.test(terms));
assert('tells the user how to flag content',
       /report that message/i.test(terms) && /report the person/i.test(terms));
assert('tells the user how to block someone',
       /block them/i.test(terms) && /Blocked accounts/i.test(terms));
assert('commits to a timeframe for acting on a report',
       /within 24 hours/i.test(terms));
assert('names ejecting the offending user, not only removing the post',
       /ejecting the person who posted it/i.test(terms));
assert('carries the Apple licensed-application terms',
       /third-party beneficiaries of these terms/i.test(terms) &&
       /Apple is not responsible for\s+the app/i.test(terms));
// The in-app checkbox stamps `TERMS_VERSION` (app/constants/legal.ts) onto the account.
// It is an ISO date so it can be read back against this line; if the two drift, the
// stored version no longer identifies a document anyone can fetch.
assert('carries a "Last updated" date the app version can be checked against',
       /class="updated">Last updated \d{1,2} \w+ \d{4}</.test(terms));
// The page describes the app's own controls. A claim about a control that does not
// exist is the failure mode that costs a SECOND rejection, since a reviewer checks.
assert('does not promise moderation the app does not have',
       !/automated filter/i.test(terms) && !/community moderator/i.test(terms) &&
       !/reputation system/i.test(terms));

console.log('\n--- deferred invite: carrying the id through an App Store install ---');
// A universal link only opens the app when the app was ALREADY installed, so the tap
// that sends someone to the store carries nothing. The page copies the invite URL in
// the SAME gesture; app/hooks/useDeferredInvite.ts offers it on first launch.
// ⚠️ STOPGAP — tear this section down with the clipboard write when Branch.io ships.
const F = (v) => ({ stringValue: v });
const PREVIEW = { fields: { groupId: F('g1'), groupName: F('Family'), inviterHandle: F('alex'),
                            visibility: F('private') } };

const before = run('/i/abc123', PREVIEW);
assert('a resolved invite shows the invite card', before.visible.join() === 'invite');
assert('NOTHING is copied before the install button is pressed', before.copied.length === 0);
assert('the after-install line is hidden until it is needed', before.els.afterInstall.hidden === true);

const after = run('/i/abc123', PREVIEW);
after.els.install.click();
assert('pressing Get Searchlight copies THIS invite url, not the bare domain',
       after.copied.length === 1 && after.copied[0] === 'https://searchlight.social/i/abc123');
assert('the install button still goes to the App Store', after.els.install.href === APP_STORE_URL);
assert('the after-install line appears on the press', after.els.afterInstall.hidden === false);
assert('the line tells them to tap the link again — the floor under every other path',
       /tap this link again/i.test(after.els.afterInstall.textContent));

// Android has no silent clipboard probe and the alert never fires there, so the written
// sentence is the entire mechanism on that platform. A copy that throws must not take
// the store link down with it.
const noClipboard = (() => {
  const r = run('/i/abc123', PREVIEW);
  r.els.install.click();
  return r;
})();
assert('a clipboard failure still leaves a working store link and the hint',
       noClipboard.els.install.href === APP_STORE_URL &&
       noClipboard.els.afterInstall.hidden === false);

assert('the app-side parser and this page agree on the url shape',
       /searchlight\.social\/i\//.test(after.copied[0]));

process.exit(failed ? 1 : 0);
