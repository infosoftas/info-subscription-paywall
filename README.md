# Standalone browser paywall SDK

This package provides subscriber sign-in, product-access decisions and optional
soft-wall UI for publisher-owned websites. It does not sign up subscribers,
start checkout, deliver protected articles, or authorize publisher servers.
Anything sent to a browser can be inspected or recovered by disabling scripts.
For hard protection, send only a teaser and have the publisher backend
authenticate each protected-content request and enforce its own access rules.

This repository owns the SDK and its CI. SelfService owns only the optional
hosted authentication configuration endpoint; direct configuration needs no
SelfService endpoint. See the [design](docs/superpowers/specs/2026-11-12-browser-paywall-design.md)
and [plan](docs/superpowers/plans/2026-11-12-browser-paywall.md).

Version tags trigger npm packaging, public npm publication, and a GitHub Release.
Publishing requires npm trusted-publisher setup described below. A CDN host for
the browser bundle remains a separate release decision.

## Installation

After the package has been published, install it in a publisher app:

```shell
npm install @infosoftas/info-subscription-paywall
```

Or load the versioned self-contained browser bundle after release assets are
provisioned:

```html
<script src="https://YOUR_APPROVED_ASSET_HOST/paywall/VERSION/paywall.js"></script>
```

Do not replace a versioned CDN URL with an unversioned URL that can change
without a publisher deployment.

## Initialize and protect content

Both distributions accept either a hosted configuration URL or direct subscriber
authentication settings. For hosted configuration, use the tenant's deployed
SelfService origin:

```ts
import { createPaywall } from '@infosoftas/info-subscription-paywall';

const paywall = await createPaywall({
    configUrl: 'https://tenant-selfservice.example/paywall/config',
    redirectUri: `${window.location.origin}/auth-callback`,
});

const dispose = paywall.protect({
    content: '#article',
    target: '#paywall',
    products: ['c3011960-9721-40cb-b900-a70908ac5d33'],
});
```

Alternatively, pass the client ID and complete subscriber sign-in authority
directly. The authority must be an HTTPS URL ending in `/`:

```ts
const paywall = await createPaywall({
    clientId: 'YOUR_SUBSCRIBER_CLIENT_ID',
    authority: 'https://tenant.example/tenant.onmicrosoft.com/B2C_1_Signin/',
    redirectUri: `${window.location.origin}/auth-callback`,
});
```

Provide exactly one form: `configUrl`, or both `clientId` and `authority`.
Direct configuration does not contact SelfService. Hosted configuration is
fetched without cookies (`credentials: 'omit'`). Both values are public; never
put a client secret in browser code.

The script-tag bundle exposes the equivalent factory as
`InfoSubscriptionPaywall.create(...)` and accepts the same options. Neither
build contains tenant authentication settings.

The npm module can be imported during server-side rendering because module
evaluation does not access browser globals. Call `createPaywall` only after the
publisher page has mounted in a browser. The included script-tag example sets
the protected article hidden before the bundle runs and includes static
no-JavaScript and script-load-failure fallback content. Hiding content in the
browser is only a presentation improvement, not a security boundary.

## Authentication and callback registration

Subscriber authentication uses MSAL Browser's authorization-code flow with
PKCE. No browser client secret is used. The publisher must provide the exact
`redirectUri`, and an administrator of the existing subscriber SPA application
must register that exact callback URL as an SPA redirect URI. A hosted config
endpoint does not register or repair an incompatible application registration.
Stop onboarding and revisit registration explicitly if the existing
application cannot accept the publisher callback.

The callback URL must serve a publisher-owned bridge page. Load the browser
bundle and call `InfoSubscriptionPaywall.completeSignIn()`, or import and call
`completeSignIn` from the npm package. Do not initialize a paywall client on
this page. No tenant configuration is needed there: the bridge relays popup
responses to the opener and returns full-page redirects to the initiating page,
where the SDK completes authentication. See `examples/script-tag/auth-callback.html`
and `examples/npm/auth-callback.ts`.

Popup sign-in is user initiated; redirect sign-in is an explicit alternative:

```ts
await paywall.signIn(); // popup
await paywall.signIn('redirect'); // explicit redirect fallback
```

The SDK never starts repeated redirects on initialization failure or a
cancelled popup. Auth state is stored in `sessionStorage` on the publisher
origin; SelfService storage and cookies are not shared. The SDK does not clear
other host-page storage or depend on third-party cookies. Sign-out calls the
standard identity-provider logout, which can affect SSO in other applications.

Subscribe to `paywall.getState()` and `paywall.subscribe(...)` for
`initializing`, `anonymous`, `authenticated`, and `failed` states. `retry()`
retries configuration/initialization after an error. `refresh()` forces a
silent MSAL claim refresh; if the identity provider requires interaction, the
SDK fails closed and the publisher can explicitly call `signIn()` again.
Cached product claims cannot reveal revocation or new access until refreshed.

## Access decisions

```ts
paywall.checkAccess('public');
paywall.checkAccess('authenticated');
paywall.checkAccess({ productIds: ['c3011960-9721-40cb-b900-a70908ac5d33'] });
```

The SDK reads `extension_Products`, whose JSON entries contain `Id`,
`ValidFrom`, and `ValidTo`. IDs are case-insensitive GUIDs. `ValidFrom` is
inclusive; an absent start date means no start restriction, but an invalid
present value denies access. `ValidTo` is exclusive and is required; absent or
invalid expiry never grants access. Empty product selections, malformed claims,
and expired authentication state fail closed. Shared subscriber accounts with
an empty `SubscriberId` can still access a matching valid product; that claim
is not an authorization requirement.

Product and token expiry are re-evaluated so a previously revealed soft-wall
does not remain open indefinitely. The SDK does not know about early
revocation or access changes until new claims are obtained. Browser clocks,
claims, and JavaScript are untrusted; publisher servers must make their own
authorization decisions.

## Optional UI

`protect` supports public, authenticated-only, or product access through
`access`, and product IDs through `products`. It hides content until access is
resolved, renders scoped accessible sign-in/denied/error UI, allows text
overrides, and returns a cleanup function:

```ts
const dispose = paywall.protect({
    content: '#article',
    target: '#paywall',
    access: 'authenticated',
    messages: {
        signIn: 'Sign in to continue.',
        accessDenied: 'Your account does not include this article.',
        error: 'Access could not be checked. Try again.',
    },
});

dispose(); // removes SDK UI/listeners and restores the publisher's content attributes
```

Errors are distinct from subscription denial and leave managed content hidden.
Publishers retain ownership of article classification, product selection,
fallback markup, and all custom UI if they choose not to use the renderer.

## Local development and validation

```shell
npm ci
npm test -- --run
npm run typecheck
npm run build
npm pack --dry-run
```

The build produces `dist/esm/index.js`, TypeScript declarations in
`dist/types/`, and a self-contained `dist/browser/paywall.js` IIFE. The browser
bundle includes MSAL; the npm module declares MSAL as its runtime dependency.
No tenant-specific settings are baked into either artifact.

The isolated browser examples are in `examples/script-tag/` and `examples/npm/`.
Live sign-in validation requires an approved test identity and registered
publisher callback; do not test against production accounts or another user's
session.

## npm releases

The `.github/workflows/package-npm.yml` workflow runs on numeric version tags,
such as `2026.11.1` or `2026.11.1-preview.1`. It tests, builds, and packs that
exact version, uploads the tarball as a workflow artifact, publishes it to npm
using trusted publishing, and creates a GitHub Release. Prereleases use npm's
`next` dist-tag; stable releases use `latest`. Tags must be valid npm versions.
The workflow does not create tags or deploy the browser bundle to a CDN.

Before the first automated release, an npm organization maintainer must ensure
the package exists, then configure a GitHub Actions trusted publisher for
`infosoftas/info-subscription-paywall` and `package-npm.yml`, allowing direct
`npm publish`. npm requires an existing package to configure this trust; initial
publication must be handled separately. Configure trust shortly before release,
because an unused trusted-publisher configuration expires after two days.
