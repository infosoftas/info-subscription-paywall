export type AccessRequirement =
    | 'public'
    | 'authenticated'
    | { productIds: readonly string[] };

export interface SubscriberSession {
    authenticated: boolean;
    expiresAt?: number;
    productsClaim?: string;
}

export type AccessDecisionReason =
    | 'public'
    | 'authenticated'
    | 'product'
    | 'anonymous'
    | 'expired-authentication'
    | 'no-products'
    | 'no-valid-product';

export interface AccessDecision {
    allowed: boolean;
    reason: AccessDecisionReason;
    recheckAt?: number;
}

interface ProductEntry {
    Id?: unknown;
    ValidFrom?: unknown;
    ValidTo?: unknown;
}

const guidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const evaluateAccess = (
    requirement: AccessRequirement,
    session: SubscriberSession | null,
    now: number = Date.now()
): AccessDecision => {
    if (requirement === 'public') {
        return { allowed: true, reason: 'public' };
    }

    if (!session?.authenticated) {
        return { allowed: false, reason: 'anonymous' };
    }

    if (
        session.expiresAt === undefined ||
        !Number.isFinite(session.expiresAt) ||
        session.expiresAt <= now
    ) {
        return { allowed: false, reason: 'expired-authentication' };
    }

    if (requirement === 'authenticated') {
        return {
            allowed: true,
            reason: 'authenticated',
            recheckAt: session.expiresAt,
        };
    }

    if (requirement.productIds.length === 0) {
        return { allowed: false, reason: 'no-products' };
    }

    const selectedProductIds = new Set(
        requirement.productIds.filter((id) => guidPattern.test(id)).map((id) => id.toLowerCase())
    );
    if (selectedProductIds.size === 0) {
        return { allowed: false, reason: 'no-products' };
    }

    const products = parseProducts(session.productsClaim);
    if (!products) {
        return {
            allowed: false,
            reason: 'no-valid-product',
            recheckAt: session.expiresAt,
        };
    }

    let recheckAt = session.expiresAt;
    for (const product of products) {
        const id = typeof product?.Id === 'string' ? product.Id : '';
        if (!guidPattern.test(id) || !selectedProductIds.has(id.toLowerCase())) {
            continue;
        }

        const validFrom = getDate(product, 'ValidFrom');
        if (validFrom === 'invalid') {
            continue;
        }

        if (typeof validFrom === 'number' && validFrom > now) {
            recheckAt = Math.min(recheckAt, validFrom);
            continue;
        }

        const validTo = getDate(product, 'ValidTo');
        if (typeof validTo !== 'number' || validTo <= now) {
            continue;
        }

        recheckAt = Math.min(recheckAt, validTo);
        return { allowed: true, reason: 'product', recheckAt };
    }

    return {
        allowed: false,
        reason: 'no-valid-product',
        ...(recheckAt > now ? { recheckAt } : {}),
    };
};

const parseProducts = (claim: string | undefined): ProductEntry[] | null => {
    if (!claim) {
        return null;
    }

    try {
        const products: unknown = JSON.parse(claim);
        return Array.isArray(products) ? (products as ProductEntry[]) : null;
    } catch {
        return null;
    }
};

const getDate = (
    product: ProductEntry,
    property: 'ValidFrom' | 'ValidTo'
): number | 'invalid' | undefined => {
    if (!Object.prototype.hasOwnProperty.call(product, property)) {
        return undefined;
    }

    const value = product[property];
    if (typeof value !== 'string' || value.length === 0) {
        return 'invalid';
    }

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 'invalid';
};
