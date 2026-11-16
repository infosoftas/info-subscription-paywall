export { evaluateAccess } from './access';
export type {
    AccessDecision,
    AccessDecisionReason,
    AccessRequirement,
    SubscriberSession,
} from './access';
export { createPaywall, createPaywall as create } from './auth';
export type {
    AuthenticationStatus,
    Paywall,
    PaywallOptions,
    PaywallState,
} from './auth';
export { renderProtectedContent } from './renderer';
export type { PaywallMessages, ProtectOptions } from './renderer';
export { broadcastResponseToMainFrame as completeSignIn } from '@azure/msal-browser/redirect-bridge';
