import type { AccountInfo, AuthenticationResult } from '@azure/msal-browser';

import { evaluateAccess, type AccessDecision, type AccessRequirement } from './access';
import { renderProtectedContent, type ProtectOptions } from './renderer';

export type AuthenticationStatus =
    | 'initializing'
    | 'anonymous'
    | 'authenticated'
    | 'failed';

export interface PaywallState {
    status: AuthenticationStatus;
    expiresAt?: number;
    error?: Error;
}

export type PaywallOptions = {
    redirectUri: string;
} & (
    | { configUrl: string; clientId?: never; authority?: never }
    | { configUrl?: never; clientId: string; authority: string }
);

interface PublicConfiguration {
    clientId: string;
    authority: string;
}

interface MsalClient {
    initialize(): Promise<void>;
    handleRedirectPromise(): Promise<AuthenticationResult | null>;
    getActiveAccount(): AccountInfo | null;
    getAllAccounts(): AccountInfo[];
    setActiveAccount(account: AccountInfo | null): void;
    clearCache(request: { account: AccountInfo }): Promise<void>;
    loginPopup(request: {
        scopes: string[];
        redirectUri: string;
    }): Promise<AuthenticationResult>;
    loginRedirect(request: {
        scopes: string[];
        redirectUri: string;
    }): Promise<void>;
    logoutPopup(request: {
        account: AccountInfo | null;
        postLogoutRedirectUri: string;
    }): Promise<void>;
    acquireTokenSilent(request: {
        account: AccountInfo;
        forceRefresh: boolean;
        scopes: string[];
    }): Promise<AuthenticationResult>;
}

export interface Paywall {
    getState(): PaywallState;
    subscribe(listener: (state: PaywallState) => void): () => void;
    signIn(method?: 'popup' | 'redirect'): Promise<void>;
    signOut(): Promise<void>;
    refresh(): Promise<PaywallState>;
    retry(): Promise<void>;
    checkAccess(requirement: AccessRequirement): AccessDecision;
    protect(options: ProtectOptions): () => void;
    destroy(): void;
}

const loginScopes = ['openid', 'profile'];
const maximumTimerDelay = 2_147_000_000;

export const createPaywall = async (options: PaywallOptions): Promise<Paywall> => {
    const paywall = new PaywallClient(options);
    await paywall.initialize();
    return paywall;
};

class PaywallClient implements Paywall {
    private readonly options: PaywallOptions;
    private readonly listeners = new Set<(state: PaywallState) => void>();
    private state: PaywallState = { status: 'initializing' };
    private msal: MsalClient | null = null;
    private account: AccountInfo | null = null;
    private expiryTimer: ReturnType<typeof setTimeout> | null = null;

    public constructor(options: PaywallOptions) {
        this.options = options;
    }

    public async initialize(): Promise<void> {
        this.clearExpiryTimer();
        this.account = null;
        this.msal = null;
        this.setState({ status: 'initializing' });

        try {
            const config = await this.resolveConfiguration();
            const { BrowserCacheLocation, PublicClientApplication } =
                await import('@azure/msal-browser');
            const authority = new URL(config.authority);
            const client = new PublicClientApplication({
                auth: {
                    clientId: config.clientId,
                    authority: config.authority,
                    knownAuthorities: [authority.hostname],
                    redirectUri: this.options.redirectUri,
                    postLogoutRedirectUri: this.options.redirectUri,
                },
                cache: {
                    cacheLocation: BrowserCacheLocation.SessionStorage,
                },
            }) as unknown as MsalClient;

            this.msal = client;
            await client.initialize();
            const result = await client.handleRedirectPromise();
            const account =
                result?.account ?? client.getActiveAccount() ?? client.getAllAccounts()[0] ?? null;

            this.applyAccount(account);
        } catch (error) {
            this.account = null;
            this.msal = null;
            this.setState({ status: 'failed', error: toError(error) });
        }
    }

    public getState(): PaywallState {
        return { ...this.state };
    }

    public subscribe(listener: (state: PaywallState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public async signIn(method: 'popup' | 'redirect' = 'popup'): Promise<void> {
        const client = this.requireMsal();

        try {
            if (method === 'redirect') {
                await client.loginRedirect({
                    scopes: loginScopes,
                    redirectUri: this.options.redirectUri,
                });
                return;
            }

            const result = await client.loginPopup({
                scopes: loginScopes,
                redirectUri: this.options.redirectUri,
            });
            this.applyAccount(result.account);
        } catch (error) {
            this.setState({ ...this.state, error: toError(error) });
            throw error;
        }
    }

    public async signOut(): Promise<void> {
        const client = this.requireMsal();
        const account = this.account;

        this.clearExpiryTimer();
        this.account = null;
        client.setActiveAccount(null);
        this.setState({ status: 'anonymous' });

        try {
            if (account) {
                await client.clearCache({ account });
            }
            await client.logoutPopup({
                account,
                postLogoutRedirectUri: this.options.redirectUri,
            });
        } catch (error) {
            this.setState({ status: 'anonymous', error: toError(error) });
            throw error;
        }
    }

    public async refresh(): Promise<PaywallState> {
        const client = this.requireMsal();
        if (!this.account || this.state.status !== 'authenticated') {
            return this.getState();
        }

        try {
            const result = await client.acquireTokenSilent({
                account: this.account,
                forceRefresh: true,
                scopes: loginScopes,
            });
            this.applyAccount(result.account);
            return this.getState();
        } catch (error) {
            this.clearExpiryTimer();
            this.account = null;
            client.setActiveAccount(null);
            this.setState({ status: 'failed', error: toError(error) });
            throw error;
        }
    }

    public async retry(): Promise<void> {
        await this.initialize();
    }

    public checkAccess(requirement: AccessRequirement): AccessDecision {
        if (requirement === 'public') {
            return evaluateAccess(requirement, null);
        }

        const session = this.state.status === 'authenticated' && this.account
            ? this.getSubscriberSession(this.account)
            : null;
        return evaluateAccess(requirement, session);
    }

    public protect(options: ProtectOptions): () => void {
        return renderProtectedContent(this, options);
    }

    public destroy(): void {
        this.clearExpiryTimer();
        this.listeners.clear();
        this.account = null;
        this.msal = null;
    }

    private async resolveConfiguration(): Promise<PublicConfiguration> {
        let configuration: unknown = this.options;
        if (this.options.configUrl !== undefined) {
            if (
                typeof this.options.configUrl !== 'string' ||
                this.options.configUrl.trim().length === 0 ||
                this.options.clientId !== undefined ||
                this.options.authority !== undefined
            ) {
                throw new Error('Paywall configuration is invalid.');
            }
            const response = await fetch(this.options.configUrl, { credentials: 'omit' });
            if (!response.ok) {
                throw new Error('Unable to load paywall configuration.');
            }
            try {
                configuration = await response.json();
            } catch {
                throw new Error('Paywall configuration is invalid.');
            }
        }

        if (
            typeof configuration !== 'object' ||
            configuration === null ||
            !('clientId' in configuration) ||
            typeof configuration.clientId !== 'string' ||
            configuration.clientId.trim().length === 0 ||
            !('authority' in configuration) ||
            typeof configuration.authority !== 'string'
        ) {
            throw new Error('Paywall configuration is invalid.');
        }

        let authority: URL;
        try {
            authority = new URL(configuration.authority);
        } catch {
            throw new Error('Paywall configuration is invalid.');
        }

        if (authority.protocol !== 'https:' || !authority.pathname.endsWith('/')) {
            throw new Error('Paywall configuration is invalid.');
        }

        return {
            clientId: configuration.clientId,
            authority: authority.toString(),
        };
    }

    private applyAccount(account: AccountInfo | null): void {
        this.clearExpiryTimer();
        const expiresAt = account ? getAccountExpiry(account) : null;
        if (!account || expiresAt === null || expiresAt <= Date.now()) {
            this.account = null;
            this.msal?.setActiveAccount(null);
            this.setState({ status: 'anonymous' });
            return;
        }

        this.account = account;
        this.msal?.setActiveAccount(account);
        this.setState({ status: 'authenticated', expiresAt });
        this.scheduleExpiry(expiresAt);
    }

    private getSubscriberSession(account: AccountInfo) {
        const claims = account.idTokenClaims as Record<string, unknown> | undefined;
        const productsClaim = claims?.extension_Products;
        return {
            authenticated: true,
            expiresAt: this.state.expiresAt,
            ...(typeof productsClaim === 'string' ? { productsClaim } : {}),
        };
    }

    private scheduleExpiry(expiresAt: number): void {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
            this.applyAccount(null);
            return;
        }

        this.expiryTimer = setTimeout(
            () => {
                if (expiresAt <= Date.now()) {
                    this.applyAccount(null);
                } else {
                    this.scheduleExpiry(expiresAt);
                }
            },
            Math.min(remaining, maximumTimerDelay)
        );
    }

    private clearExpiryTimer(): void {
        if (this.expiryTimer !== null) {
            clearTimeout(this.expiryTimer);
            this.expiryTimer = null;
        }
    }

    private requireMsal(): MsalClient {
        if (!this.msal) {
            throw new Error('Paywall authentication is not initialized.');
        }

        return this.msal;
    }

    private setState(state: PaywallState): void {
        this.state = state;
        for (const listener of this.listeners) {
            try {
                listener(this.getState());
            } catch {
                // A publisher callback must not break authentication state updates.
            }
        }
    }
}

const getAccountExpiry = (account: AccountInfo): number | null => {
    const claims = account.idTokenClaims as Record<string, unknown> | undefined;
    const exp = Number(claims?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
};

const toError = (error: unknown): Error => {
    if (error instanceof Error) {
        return new Error(error.message);
    }

    return new Error('Paywall authentication failed.');
};
