import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const declaration = new URL('../dist/types/index.d.ts', import.meta.url);
const modulePath = new URL('../dist/esm/index.js', import.meta.url);
const browserBundle = new URL('../dist/browser/paywall.js', import.meta.url);

await access(declaration);
const sdk = await import(modulePath.href);
assert.equal(typeof sdk.createPaywall, 'function');
assert.equal(typeof sdk.create, 'function');
assert.equal(typeof sdk.completeSignIn, 'function');

const bundle = await readFile(browserBundle, 'utf8');
assert.doesNotMatch(bundle, /^\s*import\s/m);
assert.doesNotMatch(bundle, /\bimport\s*\(/);

const scriptTagSandbox = {};
runInNewContext(bundle, scriptTagSandbox);
assert.equal(typeof scriptTagSandbox.InfoSubscriptionPaywall?.create, 'function');
assert.equal(typeof scriptTagSandbox.InfoSubscriptionPaywall?.completeSignIn, 'function');
