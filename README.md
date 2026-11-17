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
The browser bundle is available through jsDelivr directly from the published
npm package; no separate SDK hosting service is needed.

## Publisher onboarding

Before choosing npm or script tags:

- Obtain either the tenant's deployed SelfService `/paywall/config` URL or its
  public subscriber `clientId` and complete sign-in `authority`.
- Choose a callback URL on the publisher's origin and register it as an **SPA
  redirect URI** on that subscriber application. The examples below use
  `/auth-callback.html`; register the exact scheme, hostname, port, and path.
- Choose the product GUIDs required for the article. Use `access: 'authenticated'`
  instead of `products` when testing sign-in without a subscription requirement.
- Serve pages over HTTPS, or HTTP on localhost for development. Do not open
  the examples as `file://` URLs.

Client IDs and authorities are public. Never embed a client secret or a
subscriber's credentials.

### Script tags: no build step

Save this as `index.html`, replacing the config URL and product GUID:

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Publisher article</title>
<style>[hidden] { display: none !important; }</style>
<h1>Publisher article</h1>
<p>Public teaser.</p>
<p id="status" role="status">Loading subscriber access...</p>
<div id="paywall"></div>
<article id="article" hidden>Subscriber-only article text.</article>
<noscript>Enable JavaScript to sign in.</noscript>
<script src="https://cdn.jsdelivr.net/npm/@infosoftas/info-subscription-paywall@0.1.1/dist/browser/paywall.js"></script>
<script>
    (async () => {
        const status = document.querySelector('#status');
        try {
            const paywall = await InfoSubscriptionPaywall.create({
                configUrl: 'https://tenant-selfservice.example/paywall/config',
                redirectUri: `${window.location.origin}/auth-callback.html`,
            });
            paywall.protect({
                content: '#article',
                target: '#paywall',
                products: ['YOUR_PRODUCT_GUID'],
            });
            status.hidden = true;
        } catch {
            status.textContent = 'Unable to load subscriber access. Reload to try again.';
        }
    })();
</script>
</html>
```

Save this as `auth-callback.html` at the publisher origin's root:

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Subscriber sign-in callback</title>
<p id="status" role="status">Completing sign-in...</p>
<script src="https://cdn.jsdelivr.net/npm/@infosoftas/info-subscription-paywall@0.1.1/dist/browser/paywall.js"></script>
<script>
    (async () => {
        try {
            await InfoSubscriptionPaywall.completeSignIn();
            document.querySelector('#status').textContent =
                'Sign-in response returned to the publisher page.';
        } catch {
            document.querySelector('#status').textContent =
                'Unable to complete sign-in. Close this window and retry from the article.';
        }
    })();
</script>
</html>
```

The callback needs no tenant settings and must not call `create()`. Both pages
load the same pinned SDK version. For a subdirectory deployment, change the
callback URL and registration to match its actual path.

For a local test, serve the folder containing both pages:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000/` and register
`http://localhost:8000/auth-callback.html` as the SPA callback.
Verify anonymous content stays hidden, a matching subscriber sees it, and a
subscriber without the selected product is denied. Content in this example is
still delivered in HTML; this is a soft wall, not secure content delivery.

### npm: publisher application build

Install the SDK in the publisher application:

```shell
npm install @infosoftas/info-subscription-paywall@0.1.1
```

Use the initialization below after the article elements are mounted. Provide
the same initially hidden article, paywall target, and static failure fallback
as in the script-tag example.

The callback must be a separate page whose application bundle runs this code,
not the article's normal initialization:

```ts
import { completeSignIn } from '@infosoftas/info-subscription-paywall';

completeSignIn().catch(() => {
    document.body.textContent =
        'Unable to complete sign-in. Return to the article and retry.';
});
```

Configure the publisher's build/router to serve that callback page at
`/auth-callback.html`. A raw TypeScript file or bare npm import cannot be loaded
directly by a browser without the application's build tooling.

Use the same SDK version for article and callback. Keep CDN URLs versioned;
do not use `@latest` or an unversioned URL. Update both pages deliberately when
upgrading. Publishers can also self-host the package's `dist/browser/paywall.js`.

## Initialize and protect content

Both distributions accept either a hosted configuration URL or direct subscriber
authentication settings. For hosted configuration, use the tenant's deployed
SelfService origin:

```ts
import { createPaywall } from '@infosoftas/info-subscription-paywall';

const paywall = await createPaywall({
    configUrl: 'https://tenant-selfservice.example/paywall/config',
    redirectUri: `${window.location.origin}/auth-callback.html`,
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
    redirectUri: `${window.location.origin}/auth-callback.html`,
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
The workflow does not create tags. jsDelivr serves the published package's
`dist/browser/paywall.js` using its immutable versioned URL; no separate CDN
deployment is required.

Trusted publishing is configured for this package. If it needs to be recreated,
an npm organization maintainer configures a GitHub Actions trusted publisher for
`infosoftas/info-subscription-paywall` and `package-npm.yml`, allowing direct
`npm publish` with no environment name. No npm publishing token is needed in
GitHub. Push a new numeric version tag from the intended release commit; do not
reuse published versions or prefix the tag with `v`.

## License

[MIT](LICENSE). Dependencies retain their own licenses.
