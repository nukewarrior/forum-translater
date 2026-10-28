// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings, saveTranslationOnly, type Settings } from '../src/settings';
import { activeProfile, listProfiles, makeProfile, cloneProfile, removeProfile, selectProfile, upsertProfile, type TranslationProfile } from '../src/profile-store';
import { siteKey } from '../src/site-storage';
import { TranslationCache } from '../src/translation/service';

let storage: Map<string, unknown>;
function visit(host: string): void {
  vi.stubGlobal('location', { hostname: host, href: `https://${host}/`, pathname: '/' });
}
function write(key: string, value: unknown): void { storage.set(key, structuredClone(value)); }
function storedProfile(profile: TranslationProfile): Omit<TranslationProfile, 'ai'> & { ai: Omit<TranslationProfile['ai'], 'apiKey'> } {
  const { apiKey: _key, ...ai } = profile.ai;
  return { ...profile, ai };
}
function seedLegacy(): void {
  const google = makeProfile('google', 'Google', 'google');
  const ai = makeProfile('ai', 'Shared AI', 'shared-ai');
  ai.ai = { ...ai.ai, baseUrl: 'https://example.com/v1', model: 'legacy-model' };
  write('ft:profiles:v1', { version: 1, activeId: ai.id, profiles: [storedProfile(google), storedProfile(ai)] });
  write('ft:profile-key:v1:shared-ai', 'fixture-token');
  write('ft:settings:v1', { enabled: false, body: true, translationTheme: 'paper', before: 300 });
}

beforeEach(() => {
  storage = new Map();
  vi.useFakeTimers();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => structuredClone(storage.has(key) ? storage.get(key) : fallback));
  vi.stubGlobal('GM_setValue', vi.fn(write));
  vi.stubGlobal('GM_deleteValue', vi.fn((key: string) => storage.delete(key)));
  visit('reddit.com');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([
  ['reddit.com', 'reddit'], ['www.reddit.com', 'reddit'], ['old.reddit.com', 'reddit'], ['new.reddit.com', 'reddit'],
  ['x.com', 'x'], ['www.x.com', 'x'], ['twitter.com', 'x'], ['www.twitter.com', 'x'],
])('normalizes %s to the %s namespace', (host, site) => {
  expect(siteKey('settings:v1', host)).toBe(`ft:site:${site}:settings:v1`);
  expect(siteKey('settings:v1', 'notreddit.com')).not.toBe('ft:site:reddit:settings:v1');
});

it.each([['reddit.com', 'x.com'], ['x.com', 'reddit.com']])(
  'isolates every setting changed on %s from %s',
  (changed, other) => {
    visit(other);
    const original = loadSettings();
    const snapshot = structuredClone(storage.get(siteKey('settings:v1')));
    visit(changed);
    const next: Settings = { ...loadSettings(), enabled: false, title: false, body: false, comment: false, redditFeedTitle: true,
      before: 100, after: 200, translationTheme: 'paper',
      fonts: { title: { family: 'serif', size: 22 }, body: { family: 'monospace', size: 18 } } };
    saveSettings(next);
    saveTranslationOnly(true);
    expect(loadSettings()).toEqual({ ...next, translationOnly: true });
    visit(other);
    expect(loadSettings()).toEqual(original);
    expect(storage.get(siteKey('settings:v1'))).toEqual(snapshot);
    expect(storage.has('ft:settings:v1')).toBe(false);
    expect(storage.has('ft:profiles:v1')).toBe(false);
  },
);

it.each([['reddit.com', 'x.com'], ['x.com', 'reddit.com']])(
  'keeps legacy configuration intact when %s changes before %s first migrates',
  (changed, other) => {
    seedLegacy();
    const legacy = structuredClone([...storage]);
    visit(changed);
    expect(loadSettings()).toMatchObject({ enabled: false, translationTheme: 'paper', before: 300 });
    const profile = activeProfile();
    expect(profile.ai.apiKey).toBe('fixture-token');
    saveSettings({ ...loadSettings(), enabled: true, body: false, before: 100 });
    upsertProfile({ ...profile, name: 'Local AI', ai: { ...profile.ai, model: 'local-model', apiKey: 'local-fixture-token' } });
    const copy = cloneProfile(profile.id);
    selectProfile(copy.id);
    removeProfile(profile.id);
    expect(activeProfile().id).toBe(copy.id);
    expect(storage.has(siteKey('profile-key:v1:shared-ai'))).toBe(false);
    visit(other);
    expect(loadSettings()).toMatchObject({ enabled: false, body: true, translationTheme: 'paper', before: 300 });
    expect(activeProfile()).toMatchObject({ id: 'shared-ai', name: 'Shared AI', ai: { model: 'legacy-model', apiKey: 'fixture-token' } });
    expect(listProfiles().profiles).toHaveLength(2);
    expect(storage.get(siteKey('profile-key:v1:shared-ai'))).toBe('fixture-token');
    expect(JSON.stringify(storage.get(siteKey('profiles:v1')))).not.toContain('fixture-token');
    for (const [key, value] of legacy) expect(storage.get(key)).toEqual(value);
    expect(vi.mocked(GM_deleteValue).mock.calls.every(([key]) => key.startsWith(`ft:site:${changed === 'x.com' ? 'x' : 'reddit'}:`))).toBe(true);
  },
);

it('keeps existing site settings and does not reimport edited legacy values', () => {
  seedLegacy();
  const settings = loadSettings();
  saveSettings({ ...settings, enabled: true, before: 900 });
  const profile = activeProfile();
  upsertProfile({ ...profile, ai: { ...profile.ai, apiKey: '' } });
  write('ft:settings:v1', { enabled: false, before: 100 });
  write('ft:profile-key:v1:shared-ai', 'later-legacy-token');
  expect(loadSettings()).toMatchObject({ enabled: true, before: 900 });
  expect(activeProfile().ai.apiKey).toBe('');
});

it('retries an interrupted profile migration without overwriting keys already copied', () => {
  seedLegacy();
  const key = siteKey('profiles:v1');
  vi.mocked(GM_setValue).mockImplementation((name, value) => {
    if (name === key) throw new Error('Storage unavailable');
    write(name, value);
  });
  expect(() => listProfiles()).toThrow('Storage unavailable');
  expect(storage.has(key)).toBe(false);
  expect(storage.get(siteKey('profile-key:v1:shared-ai'))).toBe('fixture-token');
  write(siteKey('profile-key:v1:shared-ai'), '');
  vi.mocked(GM_setValue).mockImplementation(write);
  expect(activeProfile().ai.apiKey).toBe('');
  expect(storage.has(key)).toBe(true);
  const writes = vi.mocked(GM_setValue).mock.calls.length;
  listProfiles();
  expect(vi.mocked(GM_setValue).mock.calls).toHaveLength(writes);
});

it('does not save partial site settings when their migration write fails', () => {
  seedLegacy();
  const key = siteKey('settings:v1');
  vi.mocked(GM_setValue).mockImplementation((name, value) => {
    if (name === key) throw new Error('Storage unavailable');
    write(name, value);
  });
  expect(() => loadSettings()).toThrow('Storage unavailable');
  expect(storage.has(key)).toBe(false);
  vi.mocked(GM_setValue).mockImplementation(write);
  expect(loadSettings()).toMatchObject({ enabled: false, before: 300, translationTheme: 'paper' });
});

it('isolates cache writes and clearing, including flush after another site becomes current', () => {
  const legacy = [['old', { text: 'legacy', expires: Date.now() + 10000 }]];
  write('ft:translations:v1', legacy);
  const reddit = new TranslationCache();
  expect(reddit.get('old')).toBeUndefined();
  reddit.set('same', 'Reddit translation');
  visit('x.com');
  const x = new TranslationCache();
  expect(x.get('same')).toBeUndefined();
  x.set('same', 'X translation');
  reddit.flush();
  x.flush();
  expect(new TranslationCache().get('same')).toBe('X translation');
  reddit.clear();
  expect(new TranslationCache().get('same')).toBe('X translation');
  visit('reddit.com');
  expect(new TranslationCache().get('same')).toBeUndefined();
  reddit.set('same', 'Reddit again');
  visit('twitter.com');
  x.clear();
  reddit.flush();
  expect(new TranslationCache().get('same')).toBeUndefined();
  visit('old.reddit.com');
  expect(new TranslationCache().get('same')).toBe('Reddit again');
  expect(storage.get('ft:translations:v1')).toEqual(legacy);
});
