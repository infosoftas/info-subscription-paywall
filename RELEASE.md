# Releases

Version tags trigger npm packaging, public npm publication, and a GitHub Release.

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

See [Development](DEVELOPMENT.md) for local validation commands.
