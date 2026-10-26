import type { AiProfile } from './settings';

export type TranslationProvider = 'google' | 'microsoft' | 'ai';
export type AiProtocol = 'responses' | 'chat-completions';

export interface TranslationProfile {
  id: string;
  name: string;
  provider: TranslationProvider;
  revision: number;
  ai: AiProfile;
}

interface StoredProfile extends Omit<TranslationProfile, 'ai'> {
  ai: Omit<AiProfile, 'apiKey'>;
}
interface StoredProfileCollection {
  version: 1;
  activeId: string;
  profiles: StoredProfile[];
}
export interface ProfileCollection {
  activeId: string;
  profiles: TranslationProfile[];
}

const KEY = 'ft:profiles:v1';
const KEY_PREFIX = 'ft:profile-key:v1:';
const LEGACY_CLEANUP_MARKER = 'ft:legacy-vocabulary-cleanup:v1';
const OLD_VOCABULARY_KEYS = ['ft:wordbook:v1', 'ft:vocabulary:v1', 'ft:combined-vocabulary:v1'];
const OLD_VOCABULARY_PREFIXES = ['ft:wordbook-detail:v1:'];

export function defaultAiConfig(): AiProfile {
  return {
    baseUrl: '', apiKey: '', model: '', prompt: '',
    protocol: 'chat-completions', requestsPerMinute: 30, tokensPerMinute: 0,
    reasoningEffort: 'auto', fastMode: false,
  };
}

export function makeProfile(provider: TranslationProvider, name: string, id: string = crypto.randomUUID()): TranslationProfile {
  return { id, name, provider, revision: 1, ai: defaultAiConfig() };
}

function isProfile(value: unknown): value is StoredProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<StoredProfile>;
  return typeof profile.id === 'string' && !!profile.id
    && typeof profile.name === 'string' && !!profile.name.trim()
    && (profile.provider === 'google' || profile.provider === 'microsoft' || profile.provider === 'ai')
    && typeof profile.revision === 'number' && Number.isInteger(profile.revision)
    && !!profile.ai && typeof profile.ai === 'object';
}

function readRaw(): StoredProfileCollection {
  const stored: unknown = GM_getValue(KEY, null);
  if (stored && typeof stored === 'object') {
    const value = stored as Partial<StoredProfileCollection>;
    if (value.version === 1 && Array.isArray(value.profiles) && value.profiles.length
      && value.profiles.every(isProfile) && typeof value.activeId === 'string'
      && value.profiles.some(profile => profile.id === value.activeId)) {
      cleanupOldTranslationAndVocabularyData();
      return value as StoredProfileCollection;
    }
  }
  const first = makeProfile('google', 'Google 翻译', 'default-google');
  const fresh: StoredProfileCollection = {
    version: 1, activeId: first.id, profiles: [{ ...first, ai: { ...first.ai, apiKey: undefined } } as StoredProfile],
  };
  // Write the new store before deleting any legacy data; the migration must be idempotent.
  GM_setValue(KEY, fresh);
  cleanupOldTranslationAndVocabularyData();
  return fresh;
}

function cleanupOldTranslationAndVocabularyData(): void {
  if (GM_getValue<boolean>(LEGACY_CLEANUP_MARKER, false)) return;
  try {
    // Preserve global fonts, appearance and site switches, but discard the
    // previous single-provider AI settings (including stale endpoint/model).
    const legacy = GM_getValue<Record<string, unknown>>('ft:settings:v1', {});
    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
      const { provider: _provider, ai: _ai, vocabulary: _vocabulary, ...global } = legacy;
      if ('provider' in legacy || 'ai' in legacy || 'vocabulary' in legacy) {
        GM_setValue('ft:settings:v1', global);
      }
    }
    GM_deleteValue('ft:ai-key:v1');
    for (const key of OLD_VOCABULARY_KEYS) GM_deleteValue(key);
    for (const key of GM_listValues()) {
      if (OLD_VOCABULARY_PREFIXES.some(prefix => key.startsWith(prefix))) GM_deleteValue(key);
    }
    GM_setValue(LEGACY_CLEANUP_MARKER, true);
  } catch {
    // Retry after next reload if interrupted; never block translation.
  }
}

export function listProfiles(): ProfileCollection {
  const raw = readRaw();
  return {
    activeId: raw.activeId,
    profiles: raw.profiles.map(profile => ({
      ...profile,
      ai: { ...defaultAiConfig(), ...profile.ai, apiKey: GM_getValue<string>(KEY_PREFIX + profile.id, '') },
    })),
  };
}

export function activeProfile(): TranslationProfile {
  const state = listProfiles();
  return state.profiles.find(profile => profile.id === state.activeId) ?? state.profiles[0]!;
}

function stored(profile: TranslationProfile): StoredProfile {
  const { apiKey: _key, ...ai } = profile.ai;
  return { id: profile.id, name: profile.name, provider: profile.provider, revision: profile.revision, ai };
}

function translationIdentity(profile: TranslationProfile): string {
  const ai = profile.ai;
  return JSON.stringify([profile.provider, ai.protocol, ai.baseUrl, ai.apiKey, ai.model, ai.prompt,
    ai.reasoningEffort, ai.fastMode]);
}

function uniqueName(profiles: TranslationProfile[], proposed: TranslationProfile): void {
  if (!proposed.name.trim()) throw new Error('请填写 Profile 名称');
  if (profiles.some(profile => profile.id !== proposed.id
    && profile.name.trim().toLowerCase() === proposed.name.trim().toLowerCase())) {
    throw new Error('Profile 名称不能重复');
  }
}

export function upsertProfile(profile: TranslationProfile): TranslationProfile {
  const current = listProfiles();
  const original = current.profiles.find(item => item.id === profile.id);
  const normalized = { ...profile, name: profile.name.trim(), ai: { ...defaultAiConfig(), ...profile.ai } };
  uniqueName(current.profiles, normalized);
  normalized.revision = original
    ? original.revision + Number(translationIdentity(original) !== translationIdentity(normalized))
    : 1;
  GM_setValue(KEY_PREFIX + normalized.id, normalized.ai.apiKey);
  const profiles = original
    ? current.profiles.map(item => item.id === normalized.id ? normalized : item)
    : [...current.profiles, normalized];
  GM_setValue(KEY, { version: 1, activeId: current.activeId, profiles: profiles.map(stored) } satisfies StoredProfileCollection);
  return normalized;
}

export function selectProfile(id: string): void {
  const state = listProfiles();
  const candidate = state.profiles.find(profile => profile.id === id);
  if (!candidate) throw new Error('Profile 不存在');
  if (candidate.provider === 'ai' && (!candidate.ai.baseUrl.trim() || !candidate.ai.model.trim())) {
    throw new Error('请先完善 AI 地址和模型');
  }
  GM_setValue(KEY, { version: 1, activeId: id, profiles: state.profiles.map(stored) } satisfies StoredProfileCollection);
}

export function removeProfile(id: string, replacementId?: string): void {
  const state = listProfiles();
  if (state.profiles.length < 2) throw new Error('至少保留一个 Profile');
  if (!state.profiles.some(profile => profile.id === id)) throw new Error('Profile 不存在');
  const remaining = state.profiles.filter(profile => profile.id !== id);
  const nextId = id !== state.activeId ? state.activeId : replacementId;
  if (!nextId || !remaining.some(profile => profile.id === nextId)) throw new Error('需要选择替代 Profile');
  GM_setValue(KEY, { version: 1, activeId: nextId, profiles: remaining.map(stored) } satisfies StoredProfileCollection);
  GM_deleteValue(KEY_PREFIX + id);
}

export function cloneProfile(id: string): TranslationProfile {
  const state = listProfiles();
  const original = state.profiles.find(profile => profile.id === id);
  if (!original) throw new Error('Profile 不存在');
  let name = original.name + ' 副本', number = 2;
  while (state.profiles.some(profile => profile.name.toLowerCase() === name.toLowerCase())) {
    name = original.name + ' 副本 ' + number++;
  }
  const copy: TranslationProfile = { ...original, id: crypto.randomUUID(), name, revision: 1,
    ai: { ...original.ai, apiKey: '' } };
  return upsertProfile(copy);
}
