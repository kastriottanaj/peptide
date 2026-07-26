// @ts-check
import { defineConfig } from 'astro/config';

// Load .env into process.env so `site` and src/lib/site.ts read the same value.
// process.loadEnvFile is built into Node >= 20.6 (this project requires >= 22.12).
try {
	process.loadEnvFile('./.env');
} catch {
	// No .env file — fall back to the default below.
}

// `site` is required for canonical URLs and sitemaps. Set PUBLIC_SITE_URL to the
// real domain in .env before launch; localhost keeps canonicals coherent locally.
// https://astro.build/config
export default defineConfig({
	site: process.env.PUBLIC_SITE_URL ?? 'http://localhost:4321',
});
