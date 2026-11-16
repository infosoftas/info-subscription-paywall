import { createPaywall } from 'infosoft-s4-client-paywall';

export const completeSubscriberSignIn = async () => {
    const status = document.querySelector<HTMLElement>('#callback-status');
    try {
        const paywall = await createPaywall({
            configUrl: 'https://tenant-selfservice.example/paywall/config',
            redirectUri: `${window.location.origin}/auth-callback.html`,
        });
        if (status) {
            status.textContent = `Subscriber sign-in status: ${paywall.getState().status}.`;
        }
    } catch {
        if (status) {
            status.textContent = 'Unable to complete subscriber sign-in.';
        }
    }
};

if (typeof window !== 'undefined') {
    void completeSubscriberSignIn();
}
