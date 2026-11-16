import type { AccessDecision, AccessRequirement } from './access';
import type { Paywall, PaywallState } from './auth';

export interface ProtectOptions {
    content: string | HTMLElement;
    target: string | HTMLElement;
    access?: AccessRequirement;
    products?: readonly string[];
    messages?: Partial<PaywallMessages>;
}

export interface PaywallMessages {
    checkingAccess: string;
    signIn: string;
    signInButton: string;
    signInError: string;
    accessDenied: string;
    error: string;
    retryButton: string;
}

const defaultMessages: PaywallMessages = {
    checkingAccess: 'Checking subscription access…',
    signIn: 'Sign in to read this content.',
    signInButton: 'Sign in',
    signInError: 'Sign-in did not complete. Please try again.',
    accessDenied: 'Your subscription does not include this content.',
    error: 'Unable to verify access. Please try again.',
    retryButton: 'Retry',
};

const maximumTimerDelay = 2_147_000_000;

export const renderProtectedContent = (
    paywall: Paywall,
    options: ProtectOptions
): (() => void) => {
    const content = resolveElement(options.content);
    const target = resolveElement(options.target);
    if (!content || !target) {
        throw new Error('Paywall content and target elements must exist.');
    }

    const requirement =
        options.access ??
        (options.products === undefined
            ? 'authenticated'
            : { productIds: options.products });
    const messages = { ...defaultMessages, ...options.messages };
    const initiallyHidden = content.hidden;
    const initiallyAriaHidden = content.getAttribute('aria-hidden');
    let ui: HTMLDivElement | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const clearExpiryTimer = () => {
        if (expiryTimer !== null) {
            clearTimeout(expiryTimer);
            expiryTimer = null;
        }
    };

    const restoreAriaHidden = () => {
        if (initiallyAriaHidden === null) {
            content.removeAttribute('aria-hidden');
        } else {
            content.setAttribute('aria-hidden', initiallyAriaHidden);
        }
    };

    const hideContent = () => {
        content.hidden = true;
        content.setAttribute('aria-hidden', 'true');
    };

    const showContent = () => {
        content.hidden = false;
        restoreAriaHidden();
    };

    const removeUi = () => {
        ui?.remove();
        ui = null;
    };

    const renderMessage = (
        message: string,
        role: 'status' | 'alert',
        button?: { label: string; onClick: () => void }
    ) => {
        if (!ui) {
            ui = document.createElement('div');
            ui.dataset.infosoftPaywallUi = '';
            ui.setAttribute('aria-live', 'polite');
            const style = document.createElement('style');
            style.textContent =
                '[data-infosoft-paywall-ui] { display: block; } [data-infosoft-paywall-ui] button { cursor: pointer; }';
            ui.append(style);
            target.append(ui);
        }

        ui.setAttribute('role', role);
        for (const child of Array.from(ui.children).slice(1)) {
            child.remove();
        }

        const paragraph = document.createElement('p');
        paragraph.textContent = message;
        ui.append(paragraph);

        if (button) {
            const element = document.createElement('button');
            element.type = 'button';
            element.textContent = button.label;
            element.addEventListener('click', button.onClick);
            ui.append(element);
        }
    };

    const scheduleRecheck = (recheckAt: number | undefined, update: () => void) => {
        clearExpiryTimer();
        if (recheckAt === undefined || !Number.isFinite(recheckAt)) {
            return;
        }

        const delay = recheckAt - Date.now();
        if (delay <= 0) {
            update();
            return;
        }

        expiryTimer = setTimeout(() => {
            if (recheckAt <= Date.now()) {
                update();
            } else {
                scheduleRecheck(recheckAt, update);
            }
        }, Math.min(delay, maximumTimerDelay));
    };

    const renderDecision = (decision: AccessDecision, update: () => void) => {
        if (decision.allowed) {
            showContent();
            removeUi();
            scheduleRecheck(decision.recheckAt, update);
            return;
        }

        hideContent();
        if (
            decision.reason === 'anonymous' ||
            decision.reason === 'expired-authentication'
        ) {
            renderMessage(messages.signIn, 'status', {
                label: messages.signInButton,
                onClick: () => {
                    void paywall.signIn('popup').catch(() => undefined);
                },
            });
        } else {
            renderMessage(messages.accessDenied, 'status');
        }
        scheduleRecheck(decision.recheckAt, update);
    };

    const update = () => {
        clearExpiryTimer();
        if (disposed) {
            return;
        }

        if (requirement === 'public') {
            showContent();
            removeUi();
            return;
        }

        const state = paywall.getState();
        switch (state.status) {
            case 'initializing':
                hideContent();
                renderMessage(messages.checkingAccess, 'status');
                return;
            case 'anonymous':
                hideContent();
                if (state.error) {
                    renderMessage(messages.signInError, 'alert', {
                        label: messages.signInButton,
                        onClick: () => {
                            void paywall.signIn('popup').catch(() => undefined);
                        },
                    });
                } else {
                    renderMessage(messages.signIn, 'status', {
                        label: messages.signInButton,
                        onClick: () => {
                            void paywall.signIn('popup').catch(() => undefined);
                        },
                    });
                }
                return;
            case 'failed':
                hideContent();
                renderMessage(messages.error, 'alert', {
                    label: messages.retryButton,
                    onClick: () => {
                        void paywall.retry().catch(() => undefined);
                    },
                });
                return;
            case 'authenticated':
                renderDecision(paywall.checkAccess(requirement), update);
                return;
        }
    };

    hideContent();
    const unsubscribe = paywall.subscribe(update);
    update();

    return () => {
        if (disposed) {
            return;
        }

        disposed = true;
        clearExpiryTimer();
        unsubscribe();
        removeUi();
        content.hidden = initiallyHidden;
        restoreAriaHidden();
    };
};

const resolveElement = (selector: string | HTMLElement): HTMLElement | null =>
    typeof selector === 'string'
        ? document.querySelector<HTMLElement>(selector)
        : selector;
