import { DEFAULT_FONTS, normalizeFonts, type FontSettings } from './fonts';
import { activeProfile } from './profile-store';
export type Kind = 'title' | 'body' | 'comment';
export const TRANSLATION_THEMES = { quote: '淡灰引用', plain: '自然正文', weakening: '弱化译文', 'dividing-line': '分隔线', underline: '下划线', highlight: '柔和高亮', paper: '纸张卡片' } as const;
export type TranslationTheme = keyof typeof TRANSLATION_THEMES;
export interface AiProfile { baseUrl: string; apiKey: string; model: string; prompt: string; requestsPerMinute: number; tokensPerMinute: number; reasoningEffort?: 'none' | 'low' | 'auto'; fastMode?: boolean; protocol?: 'responses' | 'chat-completions' }
export interface Settings {
  fonts: FontSettings;
  translationOnly: boolean; enabled: boolean; title: boolean; redditFeedTitle: boolean; body: boolean; comment: boolean;
  before: number; after: number; provider: 'google' | 'microsoft' | 'ai'; ai: AiProfile; translationTheme: TranslationTheme;
  profileId?: string; profileRevision?: number;
}
export const DEFAULTS: Settings = { fonts: DEFAULT_FONTS, translationTheme: 'quote', translationOnly: false, enabled: true, title: true, redditFeedTitle: false, body: true, comment: true, before: 600, after: 1200, provider: 'google', ai: { baseUrl: '', apiKey: '', model: '', prompt: '', requestsPerMinute: 30, tokensPerMinute: 0, reasoningEffort: 'low', fastMode: false, protocol: 'responses' } };
export function normalizeSettings(raw: Partial<Settings>): Settings {
  const value = { ...DEFAULTS, fonts: normalizeFonts(raw.fonts), ai: { ...DEFAULTS.ai } };
  value.ai.reasoningEffort = raw.ai?.reasoningEffort === 'none' ? 'none' : raw.ai?.reasoningEffort === 'auto' ? 'auto' : 'low';
  value.ai.protocol = raw.ai?.protocol === 'chat-completions' ? 'chat-completions' : 'responses';
  value.ai.fastMode = raw.ai?.fastMode === true;
  for (const key of ['baseUrl', 'apiKey', 'model', 'prompt'] as const) if (typeof raw.ai?.[key] === 'string') value.ai[key] = raw.ai[key].trim();
  for (const key of ['requestsPerMinute', 'tokensPerMinute'] as const) {
    const number = raw.ai?.[key];
    if (typeof number === 'number' && Number.isFinite(number)) value.ai[key] = Math.max(key === 'requestsPerMinute' ? 1 : 0, Math.min(1000000, Math.round(number)));
  }
  for (const key of ['enabled', 'title', 'redditFeedTitle', 'body', 'comment', 'translationOnly'] as const) if (typeof raw[key] === 'boolean') value[key] = raw[key];
  for (const key of ['before', 'after'] as const) {
    const number = raw[key];
    if (typeof number === 'number' && Number.isFinite(number)) value[key] = Math.min(5000, Math.max(0, Math.round(number)));
  }
  if (raw.provider === 'google' || raw.provider === 'microsoft' || raw.provider === 'ai') value.provider = raw.provider;
  if (raw.translationTheme && Object.hasOwn(TRANSLATION_THEMES, raw.translationTheme)) value.translationTheme = raw.translationTheme;
  if (typeof raw.profileId === 'string' && raw.profileId) value.profileId = raw.profileId;
  if (typeof raw.profileRevision === 'number' && Number.isInteger(raw.profileRevision) && raw.profileRevision > 0) value.profileRevision = raw.profileRevision;
  return value;
}

// Adapted from HN settings-store: only explicit local services may use HTTP.
export function normalizeAiBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('AI 地址必须使用 HTTPS；本机服务可使用 HTTP');
  if (url.search || url.hash) throw new Error('AI 地址不能包含查询参数或片段');
  return url.href.replace(/\/+$/, '');
}
export function validateAiProfile(ai: AiProfile): void {
  normalizeAiBaseUrl(ai.baseUrl);
  if (!ai.model.trim()) throw new Error('请填写 AI 模型');
}
export function loadSettings(): Settings {
  const settings = normalizeSettings(GM_getValue<Partial<Settings>>('ft:settings:v1', {}));
  const profile = activeProfile();
  settings.profileId = profile.id;
  settings.profileRevision = profile.revision;
  settings.provider = profile.provider;
  settings.ai = { ...profile.ai };
  settings.translationOnly = loadTranslationOnly();
  return settings;
}
export function saveSettings(settings: Settings): void {
  const { provider: _provider, ai: _ai, profileId: _profileId, profileRevision: _revision, ...global } = settings;
  GM_setValue('ft:settings:v1', { ...global, translationOnly: false });
}

export function isXSite(host = location.hostname): boolean { return /(^|\.)(x|twitter)\.com$/.test(host); }

function displayKey(url = location.href): string {
  const page = new URL(url);
  const host = page.hostname === 'reddit.com' || page.hostname.endsWith('.reddit.com') ? 'reddit.com' : isXSite(page.hostname) ? 'x.com' : page.hostname;
  return `ft:display-site:${host}/*`;
}
export function loadTranslationOnly(url = location.href): boolean {
  const key = displayKey(url);
  const stored = GM_getValue<unknown>(key, null);
  if (typeof stored === 'boolean') return stored;
  // Migrate an existing page preference once; the site preference wins thereafter.
  const page = new URL(url); page.hash = '';
  const legacy = GM_getValue<unknown>(`ft:display:${page.href}`, null);
  if (typeof legacy === 'boolean') { GM_setValue(key, legacy); return legacy; }
  return false;
}
export function saveTranslationOnly(value: boolean, url?: string): void { GM_setValue(displayKey(url), value); }
