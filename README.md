# searchlight-web

The invite landing for **Searchlight** — `https://searchlight.social/i/{inviteId}`.

One static HTML file. No backend, no framework, no build step.

## Why it exists

Searchlight's invite link used to be `searchlight:///group/{id}` — a *custom scheme*.
That is not a web address: pasted into Messages it does not open a browser, does not
offer the App Store, and for a recipient without the app it silently does nothing. A
member inviting a friend was sending a dead string, and the failure was invisible —
no error, anywhere.

This page is the `https` address that can actually be tapped.

## The one thing that changes between beta and launch

`public/index.html` → `INSTALL_URL`.

- **Beta:** the TestFlight **public link**. Get it in App Store Connect → your app →
  TestFlight → an **External** test group → enable the public link. It only exists
  *after* a build has passed **Beta App Review** (first build only, ~a day or two).
- **Launch:** the App Store URL.

Editing that one line re-points every invite already in the wild. No app release.

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

- **No universal links yet.** `ios.associatedDomains` + an
  `apple-app-site-association` file would let the `https` link open the app directly
  instead of bouncing through Safari. It is a later tap-saver, not required.
- **No analytics.** Nothing here should track a person who has not installed anything.
- **No indexing.** `noindex, nofollow` — invite previews must never surface in search.
- **Not a marketing site.** This is the invite landing only.
