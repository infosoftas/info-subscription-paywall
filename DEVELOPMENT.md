# Development

## Local development and validation

Run from the SDK repository:

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

See [Publisher onboarding](README.md#publisher-onboarding) for configuration
and callback setup, and [Releases](RELEASE.md) for publishing.
