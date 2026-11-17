# Standalone browser paywall design

Date: 2026-11-12. Ownership updated: 2026-11-16.

Status: SDK implemented in this repository. Package publication, CDN hosting,
and live subscriber sign-in validation remain separate release prerequisites.

## Purpose and ownership

Provide a framework-independent browser SDK for publisher sites without a CMS
plugin, including sites without a CMS. This repository owns subscriber sign-in,
product-access checks, optional soft-wall UI, publisher examples, documentation,
tests, npm and browser builds, and SDK CI.

The Client repository owns an optional SelfService public configuration endpoint
and its checkout settings resolver. The SDK has no source or build dependency on
Client. Runtime depends on that endpoint only when the caller selects hosted
configuration; direct settings do not contact SelfService.

Signup, checkout, CMS plugins, hosted content, product discovery, a login
broker, and publisher backend authorization are outside SDK scope.

## Configuration and authentication

Both npm and script-tag builds accept exactly one subscriber configuration form:

```ts
{
  configUrl: 'https://tenant-selfservice.example/paywall/config',
  redirectUri: 'https://publisher.example/auth-callback'
}
```

```ts
{
  clientId: 'YOUR_SUBSCRIBER_CLIENT_ID',
  authority: 'https://tenant.example/tenant.onmicrosoft.com/B2C_1_Signin/',
  redirectUri: 'https://publisher.example/auth-callback'
}
```

- Hosted configuration fetches public `clientId` and complete `authority` using
  `credentials: 'omit'`. SelfService owns the endpoint contract and CORS.
- Direct settings use the supplied values and make no configuration fetch.
  Supplying both forms, incomplete values, or invalid configuration fails
  initialization. Authority must be an HTTPS URL ending in `/`.
- Client ID and authority are public; browser code must never contain a client
  secret. This is subscriber authentication, not administrator API login.
- The publisher supplies its exact redirect URI; an administrator must register
  that URI as a SPA callback for the chosen subscriber application. The callback
  page calls `completeSignIn()` without initializing a paywall client. MSAL's
  redirect bridge relays popup responses to the opener or navigates full-page
  redirects back to the initiating page for authentication completion.
- MSAL Browser uses authorization code with PKCE and publisher-origin session
  storage. Popup sign-in is user initiated; redirect sign-in is explicit.
  SelfService cookies/storage are not shared across origins.
- Authentication/claims are snapshots. `refresh()` can request fresh claims,
  but provider behavior and provisioning delays mean it does not guarantee
  immediate visibility of changes. Interactive sign-in may be necessary.

SelfService configuration is proposed in
[Client PR 13807](https://dev.azure.com/infosoftas/S4/_git/Client/pullrequest/13807);
it is available only after that change is merged and deployed.

## Access and presentation

- Support public, authenticated, and any-selected-product access.
- Product entitlement comes from `extension_Products`; compare GUIDs
  case-insensitively. Missing `ValidFrom` is unrestricted; invalid present
  `ValidFrom` denies. `ValidFrom` is inclusive and `ValidTo` is exclusive;
  missing or invalid `ValidTo` denies. Expired authentication denies access.
- A shared user may have an empty `extension_SubscriberId`; that claim is not
  required for entitlement checks.
- Optional renderer controls caller-selected content, displays configurable
  sign-in/denial/error UI, and cleans up its own changes. Callers may instead
  use the authentication/access API with their own UI.
- Renderer hides protected content while resolving access. Publishers must
  supply initial hidden state and a no-JavaScript/load-failure fallback.

**Soft-wall limitation:** article content already delivered to the browser can
be recovered regardless of JavaScript. For hard protection, the publisher's
backend must independently authenticate, authorize, and withhold content.
Never treat a browser access decision or an ID token as generic backend
authorization.

## Distribution and validation

The package builds an ES module with TypeScript declarations and a
self-contained script-tag bundle. npm imports are SSR-safe; initialization
requires a browser. Runtime tenant settings are not embedded in either build.

GitHub Actions runs SDK tests, type checking, builds, package dry-run, and
publishes build artifacts. Version tags trigger packaging and publication of
`@infosoftas/info-subscription-paywall` using npm trusted publishing, followed
by a GitHub Release. jsDelivr serves the self-contained browser bundle from
the published npm package at an explicitly pinned version; publishers may also
self-host it. No separate CDN deployment is required. The SDK is MIT licensed.
SelfService deploys its own endpoint independently.

Unit tests cover authentication, direct/hosted configuration, entitlement
boundaries, rendering, SSR-safe import, and examples. A live OIDC check
requires an approved test identity and registered publisher callback; local
tests do not establish live identity-provider compatibility.
