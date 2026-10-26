// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULTS, normalizeSettings } from '../src/settings';
import { fontTargets } from '../src/fonts';

afterEach(() => vi.unstubAllGlobals());

it('ignores obsolete X layout preferences without losing translation settings', () => {
  const settings = normalizeSettings({ ...DEFAULTS, xCollapseSidebar: true, xHideRightSidebar: true, xHideAds: true, xHideFloatingIcons: true, after: 900 } as unknown as typeof DEFAULTS);
  expect(settings).not.toHaveProperty('xCollapseSidebar');
  expect(settings).not.toHaveProperty('xHideRightSidebar');
  expect(settings).not.toHaveProperty('xHideAds');
  expect(settings).not.toHaveProperty('xHideFloatingIcons');
  expect(settings.after).toBe(900);
});

it('only styles generated translations on X, not native tweet text', () => {
  vi.stubGlobal('location', { hostname: 'x.com' });
  expect(fontTargets('body')).toContain('[data-ft-owned="translation"]');
  expect(fontTargets('body')).not.toContain('tweetText');
});

it('does not override X navigation, sidebars, dialogs, media or source text', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  for (const marker of ['data-ft-x-post-layout', 'data-ft-x-right-hidden', 'data-ft-x-sidebar-collapsed', 'data-ft-x-search', 'data-ft-x-hidden-icon', 'data-ft-long-post', 'data-ft-x-ad', 'Tweet-User-Avatar']) {
    expect(css).not.toContain(marker);
  }
  expect(css).not.toMatch(/article\[data-testid="tweet"\]\s*\{/);
});
