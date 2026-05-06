/**
 * fetch-text.mjs — shared helper for fetching a URL and extracting
 * plain text. Detects PDF vs HTML by extension/content-type.
 *
 * For HTML, strips tags but preserves block-level newlines so regex
 * patterns that need single-line context (e.g. "Total Sales: 1,42,857
 * units") still work.
 */

export async function fetchAsText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; pv-dashboard-bot)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (url.toLowerCase().endsWith('.pdf') || ct.includes('pdf')) {
    const mod = await import('pdf-parse/lib/pdf-parse.js');
    const pdf = mod.default || mod;
    const out = await pdf(buf);
    return { text: out.text || '', kind: 'pdf', bytes: buf.length };
  }
  return { text: htmlToText(buf.toString('utf-8')), kind: 'html', bytes: buf.length };
}

export function htmlToText(html) {
  return String(html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(?:p|div|tr|li|h[1-6]|td|th|article|section|header|footer)\s*>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&#?\w+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseIndianInt(s) {
  if (s == null) return null;
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function parseIndianFloat(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}
