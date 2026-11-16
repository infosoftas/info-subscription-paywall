import { completeSignIn } from '@infosoftas/info-subscription-paywall';

export const completeSubscriberSignIn = async () => {
    const status = document.querySelector<HTMLElement>('#callback-status');
    try {
        await completeSignIn();
        if (status) {
            status.textContent = 'Sign-in response returned to the publisher page.';
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
