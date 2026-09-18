# searchlight-web

The web presence for **Searchlight**. Two audiences, one static HTML file. No backend,
no framework, no build step.

| Path | File | Who lands there |
|---|---|---|
| `/` (and anything not `/i/…` or `/e/…`) | `public/index.html` | Someone who found the name on their own, or was told it |
| `/i/{inviteId}` | `public/index.html` | Someone a member actually invited |
| `/e/{eventId}` | `public/index.html` | Someone who tapped an event share link |
| `/privacy` | `public/privacy/index.html` | App Store submission field, and anyone who asks |
| `/support` | `public/support/index.html` | App Store submission field, and anyone stuck |

`/privacy` and `/support` are their own static files rather than views inside
`index.html`: an exact-match asset wins over the SPA fallback, so they need no routing
code, they stay independently linkable for the two App Store fields, and a legal
document does not have to live inside the marketing page.

### The support address needs a mail route

`support@searchlight.social` is printed on both pages and is the contact of record in
the privacy policy. **Cloudflare Email Routing** on this domain forwards it to a real
inbox for free — one rule in the dashboard. Until that exists the address bounces, which
is worse than having no support page at all.

## Why the invite page exists

Searchlight's invite link used to be `searchlight:///group/{id}` — a *custom scheme*.
That is not a web address: pasted into Messages it does not open a browser, does not
offer the App Store, and for a recipient without the app it silently does nothing. A
member inviting a friend was sending a dead string, and the failure was invisible —
no error, anywhere.

This page is the `https` address that can actually be tapped.

## Why the home page exists

Every path used to serve the invite view, so anyone reaching `searchlight.social`
without a link met **"This invite link isn't valid"**. The product read as broken to
exactly the people arriving with the most curiosity and the least context.

Routing is a pathname check inside `index.html`, **not** a Worker — `wrangler.jsonc`
still has no `main` script, and adding one would turn a page that cannot break into a
service that can. The home path performs no fetch at all.

The split is by **prefix**, deliberately: a mangled invite link (`/i/` with a broken
id) still meets the invite error, so the visitor knows their link is the problem and
can ask for another. Showing them the home page instead would hide a broken invite
behind a working-looking page.

### Two switches on the home page

- `INSTALL_URL` — shared with the invite view, see below.
- `INSTALL_READY` — whether `INSTALL_URL` is a real destination. It kept the home page
  honest through the beta, when a bare `testflight.apple.com` would have stranded
  whoever tapped it. **`true` since launch.** Kept rather than deleted: it is what makes
  the home CTA safe to re-point at anything.

## The install destination

`public/index.html` → `INSTALL_URL`.

**LAUNCHED 2026-09-18.** Searchlight Social is live:
`https://apps.apple.com/us/app/searchlight-social/id6762578884`. The numeric id is the
App Store's, not the bundle id — `com.searchlight.app` does not appear in any store URL.

Editing that one line re-points every invite already in the wild. No app release. The
test pins the destination, so changing it without changing `test/route.test.mjs` fails.

## Testing

```sh
node test/route.test.mjs
```

No dependencies and no test runner — it pulls the real `<script>` out of
`public/index.html`, runs it against a minimal DOM stub for each path that matters, and
asserts what each one renders, what the robots tag ends up as, and whether a fetch
fires. Exit code is the result.

It is deliberately not a snapshot: it checks the properties that would be a privacy or
trust failure if they broke — invite paths staying `noindex`, the home path never
touching the network, and a mangled invite still meeting the invite error rather than
the home page.

## Deploying

Cloudflare Workers static assets, wired to this repo — pushing to `main` deploys.
`wrangler.jsonc` sets `not_found_handling: "single-page-application"`, so `/i/anything`
serves `index.html` and the page reads the invite id from the path itself.

## Reading the invite preview

The page fetches `groupInvitePreviews/{inviteId}` from the Firestore REST API with
**no API key and no SDK**. That collection is `allow get: if true` /
`allow list: if false`, written server-side only by the `onGroupInviteCreated`
trigger, and carries a deliberately minimal projection: group name, description,
visibility, inviter handle.

Verified 2026-08-03 — an anonymous GET with no credential returns `404` for a missing
doc, i.e. the read is permitted and the document simply is not there.

If a read ever returns **403**, the cause is the Firestore rules, not a missing key.
That exact symptom appeared on 2026-08-02 when the rules had never been deployed at
all: every collection returned 403, including this public one. The fix was
`firebase deploy --only firestore:rules,storage`, and CI now does it on merge.

Do **not** add an API key back. An earlier version embedded the Android client key
from `google-services.json`. Firebase client keys are public identifiers rather than
secrets — that one already ships in every app binary — but it was unnecessary here,
and an unnecessary credential in a public repo still gets flagged by scanners and can
be burned for quota on other Google APIs.

## What is deliberately not here

- **Universal links: web half shipped, app half pending a build.**
  `public/.well-known/apple-app-site-association` claims `/i/*` and `/e/*` and is served as
  JSON via `_headers`. The app still needs `ios.associatedDomains` + routing `/i/`+`/e/` to
  the invite and event screens, plus a rebuild, before the `https` link opens the app
  directly; until then it opens this page and the "I already have the app" button hands off.
- **No analytics.** Nothing here should track a person who has not installed anything.
- **No waiting list, no email capture.** Decided 2026-08-03: the beta is reached by a
  TestFlight **public link**, so anyone holding it installs directly and there is
  nobody to email. Capturing addresses would have meant adding a Worker route — the
  one thing that turns this into a service that can fail — to collect a list whose only
  purpose was working around an invite bottleneck the public link removes.

## The privacy policy is written from the code

`public/privacy/index.html` is not a template. Every collection claim in it traces to
`PROJECT_DOCUMENTATION/COMMUNITY/APP_STORE_PRIVACY_LABELS.md` in the app repo, which was
itself reconciled against the SDKs actually initialised in the build and grep-verified —
including the two negatives that matter: analytics are **not** linked to account
identity (no `identify()` call exists), and crash reports carry **no** PII (no
`setUser`, `sendDefaultPii` off).

**When the app's data handling changes, this page changes with it.** A policy that
drifts from the build is worse than no policy, because it is a written claim rather than
an omission. Two specific tripwires:

- Shipping the location feature (`BAR_CRAWL_LIVE_LOCATION_UI_ENABLED`) makes "the app
  does not collect your location" false.
- Adding `Sentry.setUser` or a PostHog `identify()` makes "not linked to your account"
  false in two places at once.

The policy also says plainly that ending a Searchlight **hides** the event rather than
erasing it, because the app has no `deleteDoc` on events — the marketing line "the
events disappear" is true of the experience and not of the database, and the legal page
is the wrong place to blur that.

## Indexing — read before touching the robots tag

The tag ships as `noindex, nofollow` and the script **relaxes it on the home path
only**. Both halves matter:

- Invite pages must never be indexed — they render who invited you and to what.
- The home page should be, or nobody finds it.

The default is deny because the failure directions are not symmetrical. A crawler that
does not run JavaScript sees `noindex` and skips: the home page merely goes unindexed,
which is harmless and reversible. Ship it indexable and add `noindex` in JS instead, and
the first crawler that skips the script leaks every invite preview into search.

Do not "simplify" this by editing the meta tag to `index, follow`. A routing test pins
it (`/i/…` must stay `noindex`), and it was mutation-checked: hoisting the relaxation
out of the home branch fails that assertion.
