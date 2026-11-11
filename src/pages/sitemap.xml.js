// Sitemap without a plugin. Towns with no nearby frost record are noindex and left out.
import { towns, crops, answers, site } from '../lib/data.mjs';

export function GET() {
  const urls = [
    '/',
    '/crops/',
    '/about/',
    ...towns.filter((t) => answers.towns[t.slug].headline.s !== 'norecord').map((t) => `/co/${t.slug}/`),
    ...crops.map((c) => `/crops/${c.slug}/`),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `<url><loc>${site.url}${u}</loc></url>`).join('\n') +
    `\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
