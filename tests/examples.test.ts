import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const scriptExample = new URL('../examples/script-tag/index.html', import.meta.url);
const npmExample = new URL('../examples/npm/main.ts', import.meta.url);
const publicEntry = new URL('../src/index.ts', import.meta.url);

describe('publisher examples', () => {
    it('exports the factory name used by the script-tag distribution', async () => {
        const entry = await readFile(publicEntry, 'utf8');

        expect(entry).toMatch(/createPaywall\s+as\s+create/);
    });

    it('demonstrates initial hiding and a static no-script fallback for script tags', async () => {
        const html = await readFile(scriptExample, 'utf8');

        expect(html).toContain('src="../../dist/browser/paywall.js"');
        expect(html).toContain('InfoSubscriptionPaywall.create(');
        expect(html).toContain('<article id="article" hidden>');
        expect(html).toContain('<noscript>');
        expect(html).toContain('Unable to load the subscriber paywall');
    });

    it('uses the same runtime config and public API through the npm module', async () => {
        const [html, typescript] = await Promise.all([
            readFile(new URL('../examples/npm/index.html', import.meta.url), 'utf8'),
            readFile(npmExample, 'utf8'),
        ]);

        expect(typescript).toContain("from '@infosoftas/info-subscription-paywall'");
        expect(typescript).toContain('createPaywall(');
        expect(typescript).toContain('paywall.protect(');
        expect(typescript).toContain('https://tenant-selfservice.example/paywall/config');
        expect(html).toContain('/src/main.ts');
    });

    it('demonstrates redirect callback processing in both distributions', async () => {
        const [scriptCallback, npmCallback] = await Promise.all([
            readFile(new URL('../examples/script-tag/auth-callback.html', import.meta.url), 'utf8'),
            readFile(new URL('../examples/npm/auth-callback.ts', import.meta.url), 'utf8'),
        ]);

        expect(scriptCallback).toContain('InfoSubscriptionPaywall.completeSignIn(');
        expect(npmCallback).toContain("from '@infosoftas/info-subscription-paywall'");
        expect(npmCallback).toContain('await completeSignIn()');
        expect(scriptCallback).not.toContain('InfoSubscriptionPaywall.create(');
        expect(npmCallback).not.toContain('createPaywall(');
    });
});
