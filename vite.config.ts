import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
    const isBrowserBuild = mode === 'browser';

    return {
        build: {
            outDir: isBrowserBuild ? 'dist/browser' : 'dist/esm',
            lib: {
                entry: 'src/index.ts',
                name: 'InfoSubscriptionPaywall',
                formats: [isBrowserBuild ? 'iife' : 'es'],
                fileName: () => (isBrowserBuild ? 'paywall.js' : 'index.js'),
            },
            rollupOptions: {
                output: isBrowserBuild ? { inlineDynamicImports: true } : {},
            },
        },
    };
});
