// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Paywall, PaywallState } from '../src/auth';
import { renderProtectedContent } from '../src/renderer';

const productId = 'c3011960-9721-40cb-b900-a70908ac5d33';

const createPaywall = (initialState: PaywallState = { status: 'initializing' }) => {
    let state = initialState;
    const listeners = new Set<(next: PaywallState) => void>();
    const paywall = {
        getState: vi.fn(() => state),
        subscribe: vi.fn((listener: (next: PaywallState) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }),
        signIn: vi.fn().mockResolvedValue(undefined),
        signOut: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn().mockResolvedValue(state),
        retry: vi.fn().mockResolvedValue(undefined),
        checkAccess: vi.fn().mockReturnValue({
            allowed: false,
            reason: 'anonymous',
        }),
        destroy: vi.fn(),
    } as unknown as Paywall;

    return {
        paywall,
        setState(next: PaywallState) {
            state = next;
            listeners.forEach((listener) => listener(next));
        },
        listeners,
    };
};

const setupDom = () => {
    document.body.innerHTML =
        '<main id="mount"><article id="article"><p>Publisher-owned text</p></article></main>';
    return {
        content: document.querySelector<HTMLElement>('#article')!,
        mount: document.querySelector<HTMLElement>('#mount')!,
    };
};

describe('renderProtectedContent', () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('keeps content hidden until authenticated product access resolves', () => {
        const { content, mount } = setupDom();
        const auth = createPaywall();

        renderProtectedContent(auth.paywall, {
            content: '#article',
            target: '#mount',
            products: [productId],
        });

        expect(content.hidden).toBe(true);
        expect(mount.querySelector('[role="status"]')?.textContent).toContain(
            'Checking subscription access'
        );

        auth.setState({ status: 'authenticated', expiresAt: Date.now() + 60_000 });
        (auth.paywall.checkAccess as ReturnType<typeof vi.fn>).mockReturnValue({
            allowed: true,
            reason: 'product',
        });
        auth.setState({ status: 'authenticated', expiresAt: Date.now() + 60_000 });

        expect(content.hidden).toBe(false);
        expect(content.textContent).toContain('Publisher-owned text');
        expect(mount.querySelector('[data-infosoft-paywall-ui]')).toBeNull();
    });

    it('shows access denied separately from configuration or authentication errors', () => {
        const { content, mount } = setupDom();
        const auth = createPaywall({ status: 'authenticated', expiresAt: Date.now() + 60_000 });
        (auth.paywall.checkAccess as ReturnType<typeof vi.fn>).mockReturnValue({
            allowed: false,
            reason: 'no-valid-product',
        });

        renderProtectedContent(auth.paywall, {
            content: '#article',
            target: '#mount',
            products: [productId],
        });
        expect(mount.querySelector('[role="status"]')?.textContent).toContain(
            'does not include this content'
        );

        auth.setState({ status: 'failed', error: new Error('config unavailable') });

        expect(content.hidden).toBe(true);
        expect(mount.querySelector('[role="alert"]')?.textContent).toContain(
            'Unable to verify access'
        );
        expect(mount.querySelector('[role="alert"]')?.textContent).not.toContain(
            'does not include this content'
        );
    });

    it('supports configurable UI strings and user-initiated sign-in', async () => {
        const { mount } = setupDom();
        const auth = createPaywall({ status: 'anonymous' });
        renderProtectedContent(auth.paywall, {
            content: '#article',
            target: '#mount',
            messages: {
                signIn: 'Members sign in here',
                signInButton: 'Member sign in',
            },
        });

        expect(mount.querySelector('[role="status"]')?.textContent).toContain(
            'Members sign in here'
        );
        mount.querySelector<HTMLButtonElement>('button')!.click();
        await Promise.resolve();

        expect(auth.paywall.signIn).toHaveBeenCalledWith('popup');
    });

    it('offers retry for initialization errors without labeling them denied', async () => {
        const { mount } = setupDom();
        const auth = createPaywall({
            status: 'failed',
            error: new Error('server error'),
        });
        renderProtectedContent(auth.paywall, {
            content: '#article',
            target: '#mount',
        });

        expect(mount.querySelector('[role="alert"]')?.textContent).toContain(
            'Unable to verify access'
        );
        mount.querySelector<HTMLButtonElement>('button')!.click();
        await Promise.resolve();

        expect(auth.paywall.retry).toHaveBeenCalledOnce();
    });

    it('allows public access without waiting for authentication initialization', () => {
        const { content, mount } = setupDom();
        const auth = createPaywall();

        renderProtectedContent(auth.paywall, {
            content: '#article',
            target: '#mount',
            access: 'public',
        });

        expect(content.hidden).toBe(false);
        expect(mount.querySelector('[data-infosoft-paywall-ui]')).toBeNull();
    });

    it('rechecks at entitlement expiry and hides content after access expires', async () => {
        vi.useFakeTimers();
        const { content } = setupDom();
        const auth = createPaywall({ status: 'authenticated', expiresAt: Date.now() + 60_000 });
        (auth.paywall.checkAccess as ReturnType<typeof vi.fn>)
            .mockReturnValueOnce({
                allowed: true,
                reason: 'product',
                recheckAt: Date.now() + 1_000,
            })
            .mockReturnValue({
                allowed: false,
                reason: 'no-valid-product',
            });

        renderProtectedContent(auth.paywall, {
            content: '#article',
            target: '#mount',
            products: [productId],
        });
        expect(content.hidden).toBe(false);

        await vi.advanceTimersByTimeAsync(1_100);

        expect(content.hidden).toBe(true);
    });

    it('restores caller-owned content attributes and cleans up SDK UI and listeners', () => {
        const { content, mount } = setupDom();
        content.setAttribute('aria-hidden', 'false');
        const originalMarkup = content.innerHTML;
        const auth = createPaywall();
        const dispose = renderProtectedContent(auth.paywall, {
            content: '#article',
            target: '#mount',
            products: [productId],
        });

        expect(content.hidden).toBe(true);
        expect(content.getAttribute('aria-hidden')).toBe('true');
        expect(mount.querySelector('[data-infosoft-paywall-ui] style')?.textContent).toContain(
            '[data-infosoft-paywall-ui]'
        );

        dispose();

        expect(content.hidden).toBe(false);
        expect(content.getAttribute('aria-hidden')).toBe('false');
        expect(content.innerHTML).toBe(originalMarkup);
        expect(mount.querySelector('[data-infosoft-paywall-ui]')).toBeNull();
        expect(auth.listeners.size).toBe(0);
    });
});
