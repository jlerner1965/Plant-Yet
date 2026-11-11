// robots.txt built from config/site.json so a domain change is a one-line edit.
import { site } from '../lib/data.mjs';

export function GET() {
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain' } });
}
