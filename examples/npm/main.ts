import { createPaywall } from 'infosoft-s4-client-paywall';

export const initializePaywall = async () => {
    const paywall = await createPaywall({
        configUrl: 'https://tenant-selfservice.example/paywall/config',
        redirectUri: `${window.location.origin}/auth-callback.html`,
    });

    return paywall.protect({
        content: '#article',
        target: '#paywall',
        products: ['c3011960-9721-40cb-b900-a70908ac5d33'],
    });
};

if (typeof window !== 'undefined') {
    void initializePaywall();
}
