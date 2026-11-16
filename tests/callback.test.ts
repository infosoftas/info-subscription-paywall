// @vitest-environment jsdom

import { BroadcastChannel } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as sdk from '../src/index';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
});

describe('subscriber callback', () => {
    it('relays a popup response from the script-tag callback without initializing authentication', async () => {
        const state = btoa(JSON.stringify({
            id: 'paywall-callback-test',
            meta: { interactionType: 'popup' },
        }));
        const payload = new URLSearchParams({ state, code: 'test-authorization-code' }).toString();
        window.history.replaceState(null, '', `/examples/script-tag/auth-callback.html#${payload}`);
        const close = vi.spyOn(window, 'close').mockImplementation(() => {});
        vi.stubGlobal('BroadcastChannel', BroadcastChannel);
        vi.stubGlobal('InfoSubscriptionPaywall', sdk);
        vi.stubGlobal('fetch', () => { throw new Error('Callback must not fetch configuration or tokens.'); });

        const receiver = new BroadcastChannel('paywall-callback-test');
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const html = await readFile(
                resolve('examples', 'script-tag', 'auth-callback.html'),
                'utf8'
            );
            document.body.innerHTML = html;
            const inline = document.querySelector('script:not([src])')?.textContent;
            expect(inline).toBeTruthy();

            let response: unknown;
            const received = new Promise<void>((resolve) => {
                receiver.onmessage = (event) => {
                    response = event.data;
                    resolve();
                };
            });
            await new Function(`return ${inline?.trim()}`)();
            await Promise.race([
                received,
                new Promise((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('Callback did not relay the popup response.')), 1000);
                }),
            ]);

            expect(response).toEqual({ v: 1, payload });
            expect(window.location.hash).toBe('');
            expect(close).toHaveBeenCalledOnce();
            expect(document.body.textContent).not.toContain('test-authorization-code');
        } finally {
            clearTimeout(timeout);
            receiver.close();
        }
    });
});
