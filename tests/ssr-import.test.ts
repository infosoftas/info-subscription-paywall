import { describe, expect, it, vi } from 'vitest';

describe('public entry point', () => {
    it('can be imported without browser globals', async () => {
        vi.resetModules();
        vi.stubGlobal('window', undefined);

        const sdk = await import('../src/index');

        expect(sdk.createPaywall).toEqual(expect.any(Function));
    });
});
