# Standalone browser paywall plan

**Specification:** [Standalone browser paywall design](../specs/2026-11-12-browser-paywall-design.md)

**Status:** SDK implemented in this repository. The SDK originally planned in
Client was moved here; Client retains only SelfService configuration-related
work. This plan records current ownership and remaining release gates, not a
request to recreate completed implementation.

## SDK scope

1. Maintain the TypeScript SDK and its public npm-module and script-tag APIs.
   Both distribution formats support hosted `configUrl` or direct `clientId`
   and `authority`, plus the publisher's registered `redirectUri`.
2. Maintain subscriber sign-in/out and redirect handling using MSAL Browser,
   session storage, explicit refresh, and SSR-safe imports.
3. Maintain product-claim access checks and optional framework-independent
   soft-wall UI, including errors, cleanup, examples, and documentation.
4. Maintain SDK tests, TypeScript checks, both builds, package dry-run, and
   GitHub Actions CI and npm releases in this repository.

### Implementation inventory

- `src/auth.ts`: initialize MSAL from exactly one configuration form, expose
  state, popup/redirect sign-in, sign-out, expiry, retry, and refresh. Direct
  configuration must not fetch; hosted configuration omits credentials.
  Initialization failures are exposed through the failed state.
- `src/access.ts`: evaluate public, authenticated, and any-product rules;
  enforce GUID and product-date validity without requiring `SubscriberId`.
- `src/renderer.ts`: optionally hide/reveal content, distinguish error from
  access denial, allow text customization, and clean up SDK-owned state.
- `src/index.ts`: export equivalent public SDK functionality for npm and the
  script-tag global. Browser dependencies load at initialization, not import.
- `tests/`: cover authentication/configuration, expiry, product boundaries,
  presentation, examples, and SSR-safe import. Both hosted and direct options
  must remain covered.
- `examples/`, `README.md`, and `.github/workflows/`: document publisher setup,
  validate npm/browser artifacts, and release npm packages independently of
  Client's deployment.

SelfService owns the optional `/paywall/config` endpoint, shared checkout
configuration resolver, endpoint-specific CORS, related tests, and deployment.
See [Client PR 13807](https://dev.azure.com/infosoftas/S4/_git/Client/pullrequest/13807).
Direct configuration does not require that endpoint.

## Verification

Run from the SDK repository:

```shell
npm ci
npm test
npm run typecheck
npm run build
npm pack --dry-run
```

Local validation after the repository split passed 43 tests, type checking,
both distribution builds and package dry-run. GitHub Actions also passed.
These checks do not replace a live sign-in test.

## Remaining release and integration gates

- Register an exact publisher SPA callback on the intended subscriber
  application and use an approved test identity to validate popup and redirect
  sign-in with both configuration forms.
- If hosted configuration is used, merge and deploy the Client endpoint change,
  then validate cross-origin configuration reads. Direct configuration can be
  used without SelfService.
- Create the npm package and configure trusted publishing for
  `package-npm.yml` before the first automated release. Select and provision a
  CDN host separately for the browser bundle.
- Publishers needing hard protection must implement independent backend
  authentication and authorization; SDK soft-wall behavior is not protection
  of delivered HTML.
