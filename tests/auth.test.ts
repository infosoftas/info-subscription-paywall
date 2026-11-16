import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const msal = vi.hoisted(() => {
    const instance = {
        initialize: vi.fn(),
        handleRedirectPromise: vi.fn(),
        getActiveAccount: vi.fn(),
        getAllAccounts: vi.fn(),
        setActiveAccount: vi.fn(),
        clearCache: vi.fn(),
        loginPopup: vi.fn(),
        loginRedirect: vi.fn(),
        logoutPopup: vi.fn(),
        acquireTokenSilent: vi.fn(),
    };

    return {
        instance,
        PublicClientApplication: vi.fn(function () {
            return instance;
        }),
    };
});

vi.mock('@azure/msal-browser', () => ({
    BrowserCacheLocation: { SessionStorage: 'sessionStorage' },
    PublicClientApplication: msal.PublicClientApplication,
}));

import { createPaywall } from '../src/auth';

const configUrl = 'https://tenant.example/paywall/config';
const redirectUri = 'https://publisher.example/auth-callback';

const createAccount = (claims: Record<string, unknown> = {}) => ({
    homeAccountId: 'reader',
    environment: 'tenant.example',
    tenantId: 'tenant',
    username: 'reader@example.com',
    localAccountId: 'reader',
    name: 'Reader',
    idTokenClaims: {
        exp: Math.floor(Date.now() / 1000) + 3600,
        extension_Products: '[]',
        ...claims,
    },
});

const configResponse = (body: unknown = {
    clientId: 'public-client',
    authority: 'https://tenant.example/tenant.onmicrosoft.com/B2C_1_Signin/',
}) => new Response(JSON.stringify(body), { status: 200 });

describe('createPaywall authentication lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        msal.instance.initialize.mockResolvedValue(undefined);
        msal.instance.handleRedirectPromise.mockResolvedValue(null);
        msal.instance.getActiveAccount.mockReturnValue(null);
        msal.instance.getAllAccounts.mockReturnValue([]);
        msal.instance.clearCache.mockResolvedValue(undefined);
        msal.instance.loginPopup.mockResolvedValue({ account: createAccount() });
        msal.instance.loginRedirect.mockResolvedValue(undefined);
        msal.instance.logoutPopup.mockResolvedValue(undefined);
        msal.instance.acquireTokenSilent.mockResolvedValue({ account: createAccount() });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(configResponse()));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('fetches public configuration without cookies and initializes MSAL with session storage', async () => {
        const paywall = await createPaywall({ configUrl, redirectUri });

        expect(fetch).toHaveBeenCalledWith(configUrl, { credentials: 'omit' });
        expect(msal.PublicClientApplication).toHaveBeenCalledWith(
            expect.objectContaining({
                auth: expect.objectContaining({
                    clientId: 'public-client',
                    authority: 'https://tenant.example/tenant.onmicrosoft.com/B2C_1_Signin/',
                    redirectUri,
                    postLogoutRedirectUri: redirectUri,
                }),
                cache: { cacheLocation: 'sessionStorage' },
            })
        );
        expect(msal.instance.initialize).toHaveBeenCalledOnce();
        expect(paywall.getState().status).toBe('anonymous');
    });

    it('reports a generic failed state for config errors and retries without stale fallback', async () => {
        vi.mocked(fetch)
            .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
            .mockResolvedValueOnce(configResponse());

        const paywall = await createPaywall({ configUrl, redirectUri });
        expect(paywall.getState().status).toBe('failed');
        expect(msal.PublicClientApplication).not.toHaveBeenCalled();

        await paywall.retry();

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(paywall.getState().status).toBe('anonymous');
    });

    it('rejects malformed configuration without creating an MSAL client', async () => {
        vi.mocked(fetch).mockResolvedValue(configResponse({ clientId: '', authority: 'not-an-authority' }));

        const paywall = await createPaywall({ configUrl, redirectUri });

        expect(paywall.getState().status).toBe('failed');
        expect(msal.PublicClientApplication).not.toHaveBeenCalled();
    });

    it('processes the configured redirect return before resolving subscriber state', async () => {
        const account = createAccount();
        msal.instance.handleRedirectPromise.mockResolvedValue({ account });

        const paywall = await createPaywall({ configUrl, redirectUri });

        expect(msal.instance.handleRedirectPromise).toHaveBeenCalledOnce();
        expect(msal.instance.setActiveAccount).toHaveBeenCalledWith(account);
        expect(paywall.getState().status).toBe('authenticated');
    });

    it('uses a user-triggered popup and exposes an explicit redirect option', async () => {
        const paywall = await createPaywall({ configUrl, redirectUri });

        await paywall.signIn();
        expect(msal.instance.loginPopup).toHaveBeenCalledWith(
            expect.objectContaining({ scopes: ['openid', 'profile'], redirectUri })
        );

        await paywall.signIn('redirect');
        expect(msal.instance.loginRedirect).toHaveBeenCalledWith(
            expect.objectContaining({ scopes: ['openid', 'profile'], redirectUri })
        );
        expect(msal.instance.loginPopup).toHaveBeenCalledOnce();
    });

    it('keeps cancelled popup sign-in anonymous without redirecting automatically', async () => {
        msal.instance.loginPopup.mockRejectedValue(new Error('user_cancelled'));
        const paywall = await createPaywall({ configUrl, redirectUri });

        await expect(paywall.signIn()).rejects.toThrow('user_cancelled');

        expect(paywall.getState().status).toBe('anonymous');
        expect(msal.instance.loginRedirect).not.toHaveBeenCalled();
    });

    it('signs out through standard MSAL logout and clears the active SDK account', async () => {
        const account = createAccount();
        msal.instance.getAllAccounts.mockReturnValue([account]);
        const paywall = await createPaywall({ configUrl, redirectUri });

        await paywall.signOut();

        expect(msal.instance.logoutPopup).toHaveBeenCalledWith(
            expect.objectContaining({ account, postLogoutRedirectUri: redirectUri })
        );
        expect(msal.instance.setActiveAccount).toHaveBeenLastCalledWith(null);
        expect(paywall.getState().status).toBe('anonymous');
    });

    it('clears local access state even when identity-provider logout fails', async () => {
        const account = createAccount();
        msal.instance.getAllAccounts.mockReturnValue([account]);
        msal.instance.logoutPopup.mockRejectedValue(new Error('logout failed'));
        const paywall = await createPaywall({ configUrl, redirectUri });

        await expect(paywall.signOut()).rejects.toThrow('logout failed');

        expect(paywall.getState().status).toBe('anonymous');
        expect(paywall.checkAccess('authenticated').allowed).toBe(false);
        expect(msal.instance.setActiveAccount).toHaveBeenLastCalledWith(null);
        expect(msal.instance.clearCache).toHaveBeenCalledWith({ account });
    });

    it('publishes state changes to subscribers and supports unsubscription', async () => {
        const paywall = await createPaywall({ configUrl, redirectUri });
        const listener = vi.fn();
        const unsubscribe = paywall.subscribe(listener);

        await paywall.signIn();
        expect(listener).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'authenticated' })
        );

        unsubscribe();
        await paywall.signOut();
        expect(listener).toHaveBeenCalledOnce();
    });

    it('checks product access from the subscriber claims without requiring SubscriberId', async () => {
        const productId = 'c3011960-9721-40cb-b900-a70908ac5d33';
        const account = createAccount({
            extension_SubscriberId: '',
            extension_Products: JSON.stringify([
                { Id: productId, ValidTo: new Date(Date.now() + 60_000).toISOString() },
            ]),
        });
        msal.instance.getAllAccounts.mockReturnValue([account]);
        const paywall = await createPaywall({ configUrl, redirectUri });

        expect(paywall.checkAccess({ productIds: [productId] }).allowed).toBe(true);
    });

    it('forces a silent claim refresh and fails closed when interaction is required', async () => {
        const account = createAccount();
        msal.instance.getAllAccounts.mockReturnValue([account]);
        const paywall = await createPaywall({ configUrl, redirectUri });

        await paywall.refresh();
        expect(msal.instance.acquireTokenSilent).toHaveBeenCalledWith(
            expect.objectContaining({ account, forceRefresh: true })
        );

        msal.instance.acquireTokenSilent.mockRejectedValue(new Error('interaction_required'));
        await expect(paywall.refresh()).rejects.toThrow('interaction_required');
        expect(paywall.getState().status).toBe('failed');
        expect(msal.instance.loginPopup).not.toHaveBeenCalled();
        expect(msal.instance.loginRedirect).not.toHaveBeenCalled();
    });

    it('expires the authenticated state when the ID token expires', async () => {
        vi.useFakeTimers();
        const expiration = Math.floor(Date.now() / 1000) + 1;
        msal.instance.getAllAccounts.mockReturnValue([createAccount({ exp: expiration })]);

        const paywall = await createPaywall({ configUrl, redirectUri });
        expect(paywall.getState().status).toBe('authenticated');

        await vi.advanceTimersByTimeAsync(1_100);

        expect(paywall.getState().status).toBe('anonymous');
    });
});
