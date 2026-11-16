import { describe, expect, it } from 'vitest';

import { evaluateAccess } from '../src/access';

const now = Date.UTC(2026, 10, 12, 12);
const authExpiry = now + 60_000;
const productId = 'c3011960-9721-40cb-b900-a70908ac5d33';

describe('evaluateAccess', () => {
    it('allows public access without a subscriber session', () => {
        expect(evaluateAccess('public', null, now).allowed).toBe(true);
    });

    it('requires an authenticated subscriber for signed-in access', () => {
        expect(evaluateAccess('authenticated', null, now).allowed).toBe(false);
        expect(
            evaluateAccess('authenticated', { authenticated: true, expiresAt: authExpiry }, now).allowed
        ).toBe(true);
    });

    it('requires a valid matching product and nonempty selected products', () => {
        const session = {
            authenticated: true,
            expiresAt: authExpiry,
            productsClaim: JSON.stringify([
                { Id: productId.toUpperCase(), ValidFrom: new Date(now).toISOString(), ValidTo: new Date(now + 10_000).toISOString() },
            ]),
        };

        expect(evaluateAccess({ productIds: [] }, session, now).allowed).toBe(false);
        expect(evaluateAccess({ productIds: [productId] }, session, now).allowed).toBe(true);
        expect(evaluateAccess({ productIds: ['d3011960-9721-40cb-b900-a70908ac5d33'] }, session, now).allowed).toBe(false);
    });

    it('allows a shared-user account with an empty SubscriberId', () => {
        const session = {
            authenticated: true,
            expiresAt: authExpiry,
            subscriberId: '',
            productsClaim: JSON.stringify([
                { Id: productId, ValidTo: new Date(now + 10_000).toISOString() },
            ]),
        };

        expect(evaluateAccess({ productIds: [productId] }, session, now).allowed).toBe(true);
    });

    it('treats ValidFrom as inclusive and ValidTo as exclusive', () => {
        const claim = (validFrom: number, validTo: number) => ({
            authenticated: true,
            expiresAt: authExpiry,
            productsClaim: JSON.stringify([
                { Id: productId, ValidFrom: new Date(validFrom).toISOString(), ValidTo: new Date(validTo).toISOString() },
            ]),
        });

        expect(evaluateAccess({ productIds: [productId] }, claim(now, now + 1), now).allowed).toBe(true);
        expect(evaluateAccess({ productIds: [productId] }, claim(now + 1, now + 2), now).allowed).toBe(false);
        expect(evaluateAccess({ productIds: [productId] }, claim(now - 1, now), now).allowed).toBe(false);
    });

    it('does not grant access for missing or invalid ValidTo', () => {
        for (const validTo of [undefined, 'not-a-date']) {
            const productsClaim = JSON.stringify([{ Id: productId, ValidTo: validTo }]);
            expect(
                evaluateAccess(
                    { productIds: [productId] },
                    { authenticated: true, expiresAt: authExpiry, productsClaim },
                    now
                ).allowed
            ).toBe(false);
        }
    });

    it('treats missing ValidFrom as unrestricted but rejects a present invalid value', () => {
        const session = (validFrom: unknown) => ({
            authenticated: true,
            expiresAt: authExpiry,
            productsClaim: JSON.stringify([{ Id: productId, ValidFrom: validFrom, ValidTo: new Date(now + 10_000).toISOString() }]),
        });

        expect(
            evaluateAccess(
                { productIds: [productId] },
                { authenticated: true, expiresAt: authExpiry, productsClaim: JSON.stringify([{ Id: productId, ValidTo: new Date(now + 10_000).toISOString() }]) },
                now
            ).allowed
        ).toBe(true);
        expect(evaluateAccess({ productIds: [productId] }, session('not-a-date'), now).allowed).toBe(false);
    });

    it('rejects malformed claims, malformed entries and invalid product identifiers', () => {
        for (const productsClaim of [
            '{',
            JSON.stringify({ Id: productId }),
            JSON.stringify([{ Id: 'not-a-guid', ValidTo: new Date(now + 10_000).toISOString() }]),
            JSON.stringify([null]),
        ]) {
            expect(
                evaluateAccess(
                    { productIds: [productId] },
                    { authenticated: true, expiresAt: authExpiry, productsClaim },
                    now
                ).allowed
            ).toBe(false);
        }
    });

    it('does not grant signed-in or product access after authentication expiry', () => {
        const session = {
            authenticated: true,
            expiresAt: now,
            productsClaim: JSON.stringify([{ Id: productId, ValidTo: new Date(now + 10_000).toISOString() }]),
        };

        expect(evaluateAccess('authenticated', session, now).allowed).toBe(false);
        expect(evaluateAccess({ productIds: [productId] }, session, now).allowed).toBe(false);
    });

    it('provides the next re-evaluation time for product expiry', () => {
        const productExpiry = now + 10_000;
        const decision = evaluateAccess(
            { productIds: [productId] },
            {
                authenticated: true,
                expiresAt: authExpiry,
                productsClaim: JSON.stringify([{ Id: productId, ValidTo: new Date(productExpiry).toISOString() }]),
            },
            now
        );

        expect(decision.allowed).toBe(true);
        expect(decision.recheckAt).toBe(productExpiry);
    });
});
