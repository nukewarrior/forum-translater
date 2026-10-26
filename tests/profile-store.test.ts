// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { activeProfile, cloneProfile, defaultAiConfig, listProfiles, makeProfile, removeProfile, selectProfile, upsertProfile } from '../src/profile-store';

let store: Map<string, unknown>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => store.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => { store.set(key, value); });
  vi.stubGlobal('GM_deleteValue', (key: string) => { store.delete(key); });
  vi.stubGlobal('GM_listValues', () => [...store.keys()]);
});
afterEach(() => vi.unstubAllGlobals());

it('initializes exactly one Google profile without importing legacy AI settings', () => {
  store.set('ft:ai-key:v1', 'old-secret');
  store.set('ft:wordbook:v1', [{ word: 'unused' }]);
  store.set('ft:vocabulary:v1', [['old', 'cache']]);
  store.set('ft:wordbook-detail:v1:wiktionary:test', { old: true });
  store.set('ft:settings:v1', { provider: 'ai', ai: { baseUrl: 'https://old.example/v1', apiKey: 'old', model: 'old-model' }, vocabulary: true,
    fonts: { heading: 'Legacy Font' }, translationTheme: 'paper', xHideAds: false, before: 300 });
  store.set('ft:display-site:reddit.com/*', true);
  const state = listProfiles();
  expect(state.profiles).toHaveLength(1);
  expect(state.profiles[0]).toMatchObject({ name: 'Google 翻译', provider: 'google', id: 'default-google' });
  expect(store.has('ft:ai-key:v1')).toBe(false);
  expect(store.has('ft:wordbook:v1')).toBe(false);
  expect(store.has('ft:vocabulary:v1')).toBe(false);
  expect(store.has('ft:wordbook-detail:v1:wiktionary:test')).toBe(false);
  expect(store.get('ft:display-site:reddit.com/*')).toBe(true);
  expect(store.get('ft:settings:v1')).toEqual({
    fonts: { heading: 'Legacy Font' }, translationTheme: 'paper', xHideAds: false, before: 300,
  });
  expect(listProfiles().activeId).toBe(state.activeId);
});
it('stores API Keys independently, copies without credentials, and tracks only translation-impacting revisions', () => {
  listProfiles();
  const profile = makeProfile('ai', '硅基流动');
  profile.ai = { ...defaultAiConfig(), baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', apiKey: 'first-key' };
  const saved = upsertProfile(profile);
  expect(saved.revision).toBe(1);
  expect(listProfiles().profiles.find(item => item.id === profile.id)?.ai.apiKey).toBe('first-key');
  expect(JSON.stringify(store.get('ft:profiles:v1'))).not.toContain('first-key');
  const renamed = upsertProfile({ ...saved, name: '硅基流动备用' });
  expect(renamed.revision).toBe(1);
  const changed = upsertProfile({ ...renamed, ai: { ...renamed.ai, model: 'another-model' } });
  expect(changed.revision).toBe(2);
  const duplicated = cloneProfile(changed.id);
  expect(duplicated.id).not.toBe(changed.id);
  expect(duplicated.ai.apiKey).toBe('');
  expect(listProfiles().profiles.find(item => item.id === changed.id)?.ai.apiKey).toBe('first-key');
});
it('allows AI profiles without an API Key and prevents deleting the only profile', () => {
  const initial = activeProfile();
  expect(() => removeProfile(initial.id)).toThrow('至少保留');
  const draft = upsertProfile(makeProfile('ai', '未配置 AI'));
  expect(() => selectProfile(draft.id)).toThrow('完善');
  const complete = upsertProfile({ ...draft, ai: { ...draft.ai, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '' } });
  selectProfile(complete.id);
  expect(activeProfile().ai.apiKey).toBe('');
  removeProfile(complete.id, initial.id);
  expect(activeProfile().id).toBe(initial.id);
  expect(store.has('ft:profile-key:v1:' + complete.id)).toBe(false);
});
