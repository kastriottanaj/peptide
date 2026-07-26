// @ts-check
import { defineConfig } from 'astro/config';

// Load .env into process.env so `site` and src/lib/site.ts read the same value.
// process.loadEnvFile is built into Node >= 20.6 (this project requires >= 22.12).
try {
	process.loadEnvFile('./.env');
} catch {
	// No .env file — fall back to the default below.
}

// `site` is required for canonical URLs and sitemaps. The fallback is production
// on purpose — see the note in src/lib/site.ts. Local dev overrides it via .env.
// https://astro.build/config
export default defineConfig({
	site: process.env.PUBLIC_SITE_URL ?? 'https://peptideeinkaufen.de',
});
