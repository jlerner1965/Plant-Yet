import { defineConfig } from 'astro/config';
import site from './config/site.json' with { type: 'json' };

// Fully static output: Vercel serves the files in dist/ with no functions.
export default defineConfig({
  site: site.url,
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'always' },
  devToolbar: { enabled: false },
});
