export function isXSite(host = location.hostname): boolean { return /(^|\.)(x|twitter)\.com$/.test(host); }

// Userscript matches limit production hosts; other hosts retain their own namespace.
export function siteKey(name: string, host = location.hostname): string {
  const site = /(^|\.)reddit\.com$/.test(host) ? 'reddit' : isXSite(host) ? 'x' : host;
  return `ft:site:${site}:${name}`;
}
