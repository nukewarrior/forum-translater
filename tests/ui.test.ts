// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountControls } from '../src/ui';
import { DEFAULTS } from '../src/settings';
import { activeProfile, listProfiles } from '../src/profile-store';

let destroy: (() => void) | undefined;
let storage: Map<string, unknown>;
let nextMenu: number;
beforeEach(() => {
  storage = new Map(); nextMenu = 0;
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => storage.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => { storage.set(key, value); });
  vi.stubGlobal('GM_deleteValue', (key: string) => { storage.delete(key); });
  vi.stubGlobal('GM_listValues', () => [...storage.keys()]);
  vi.stubGlobal('GM_registerMenuCommand', vi.fn(() => ++nextMenu));
  vi.stubGlobal('GM_unregisterMenuCommand', vi.fn());
  vi.stubGlobal('confirm', vi.fn(() => true));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true,
    value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => {
  destroy?.(); destroy = undefined;
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  document.body.replaceChildren();
});
function open(): ShadowRoot {
  const menu = vi.mocked(GM_registerMenuCommand).mock.calls.find(([title]) => title.includes('翻译设置'));
  if (!menu) throw new Error('Missing settings menu');
  menu[1]();
  const shadow = document.querySelector('[data-ft-owned="controls"]')?.shadowRoot;
  if (!shadow) throw new Error('Missing controls shadow');
  return shadow;
}
function setField(shadow: ShadowRoot, name: string, value: string): void {
  const field = shadow.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${name}"]`);
  if (!field) throw new Error('Missing field ' + name);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}
describe('translation profile settings', () => {
  it('opens the new profile editor and retains the independent global display controls', () => {
    const save = vi.fn();
    destroy = mountControls(() => ({ ...DEFAULTS }), save, vi.fn());
    const shadow = open();
    expect(shadow.textContent).toContain('我的 Profile');
    expect(shadow.textContent).toContain('Google 翻译');
    expect(shadow.textContent).not.toContain('单词本');
    expect(shadow.textContent).not.toContain('词汇学习');
    const enabled = shadow.querySelector<HTMLInputElement>('[name="enabled"]');
    const after = shadow.querySelector<HTMLInputElement>('[name="after"]');
    expect(enabled).toBeTruthy(); expect(after).toBeTruthy();
    if (!enabled || !after) return;
    enabled.checked = false; after.value = '800';
    shadow.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, after: 800 }));
  });
  it('saves the independent Reddit feed-title switch without altering detail titles', () => {
    vi.stubGlobal('location', { hostname: 'www.reddit.com', pathname: '/', href: 'https://www.reddit.com/' });
    const save = vi.fn();
    destroy = mountControls(() => ({ ...DEFAULTS }), save, vi.fn());
    const shadow = open();
    const feed = shadow.querySelector<HTMLInputElement>('[name="redditFeedTitle"]');
    const detail = shadow.querySelector<HTMLInputElement>('[name="title"]');
    expect(feed?.checked).toBe(false);
    expect(detail?.checked).toBe(true);
    if (!feed) return;
    feed.checked = true;
    shadow.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ redditFeedTitle: true, title: true }));
  });
  it('creates AI profiles, saves an empty API Key and activates the selected profile', () => {
    const onChanged = vi.fn();
    destroy = mountControls(() => ({ ...DEFAULTS }), vi.fn(), vi.fn(), onChanged);
    const shadow = open();
    shadow.querySelector<HTMLButtonElement>('[data-action="new"]')?.click();
    setField(shadow, 'name', '自定义 DeepSeek');
    setField(shadow, 'provider', 'ai');
    setField(shadow, 'baseUrl', 'https://api.deepseek.com');
    setField(shadow, 'model', 'deepseek-chat');
    setField(shadow, 'protocol', 'chat-completions');
    shadow.querySelector<HTMLButtonElement>('[data-action="save"]')?.click();
    expect(listProfiles().profiles).toHaveLength(2);
    expect(listProfiles().profiles[1]?.ai.apiKey).toBe('');
    shadow.querySelector<HTMLButtonElement>('[data-action="activate"]')?.click();
    expect(activeProfile().name).toBe('自定义 DeepSeek');
    expect(activeProfile().ai.protocol).toBe('chat-completions');
    expect(onChanged).toHaveBeenCalled();
  });
  it('duplicates a profile with new identity and forbids deleting the last one', () => {
    destroy = mountControls(() => ({ ...DEFAULTS }), vi.fn(), vi.fn());
    const shadow = open();
    expect(shadow.querySelector<HTMLButtonElement>('[data-action="remove"]')?.disabled).toBe(true);
    shadow.querySelector<HTMLButtonElement>('[data-action="clone"]')?.click();
    const profiles = listProfiles().profiles;
    expect(profiles).toHaveLength(2);
    expect(profiles[1]?.id).not.toBe(profiles[0]?.id);
    expect(profiles[1]?.name).toContain('副本');
    expect(profiles[1]?.ai.apiKey).toBe('');
    shadow.querySelector<HTMLButtonElement>('[data-action="remove"]')?.click();
    expect(listProfiles().profiles).toHaveLength(1);
  });
  it('lists every saved profile in the Tampermonkey quick-menu after reopening settings', () => {
    destroy = mountControls(() => ({ ...DEFAULTS }), vi.fn(), vi.fn());
    const shadow = open();
    shadow.querySelector<HTMLButtonElement>('[data-action="clone"]')?.click();
    shadow.querySelector<HTMLButtonElement>('header button')?.click();
    expect(vi.mocked(GM_registerMenuCommand).mock.calls.map(([label]) => label))
      .toContain('　Google 翻译 副本');
  });
});

describe('Reddit homepage settings access', () => {
  it('opens the existing full settings dialog from reddit.com/ without Tampermonkey menu', async () => {
    const route = { hostname: 'www.reddit.com', pathname: '/', href: 'https://www.reddit.com/' };
    vi.stubGlobal('location', route);
    destroy = mountControls(() => ({ ...DEFAULTS }), vi.fn(), vi.fn());
    const host = document.querySelector<HTMLElement>('[data-ft-owned="reddit-home-settings"]');
    const button = host?.shadowRoot?.querySelector<HTMLButtonElement>('button');
    expect(button).toBeTruthy();
    expect(button?.hidden).toBe(false);
    button?.click();
    const dialog = document.querySelector<HTMLElement>('[data-ft-owned="controls"]')?.shadowRoot?.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(dialog?.textContent).toContain('翻译配置');
    expect(dialog?.textContent).toContain('我的 Profile');
    expect(button?.hidden).toBe(true);
    dialog?.querySelector<HTMLButtonElement>('header button')?.click();
    expect(dialog?.open).toBe(false);
    expect(button?.hidden).toBe(false);

    // Navigation to a subreddit hides the entry even with no full reload.
    route.pathname = '/r/selfhosted/';
    route.href = 'https://www.reddit.com/r/selfhosted/';
    document.body.append(document.createElement('span'));
    await vi.waitFor(() => expect(button?.hidden).toBe(true));

    route.pathname = '/';
    route.href = 'https://www.reddit.com/';
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(button?.hidden).toBe(false);
  });

  it('does not show a Reddit homepage shortcut on X or subreddit routes', () => {
    const route = { hostname: 'x.com', pathname: '/home', href: 'https://x.com/home' };
    vi.stubGlobal('location', route);
    destroy = mountControls(() => ({ ...DEFAULTS }), vi.fn(), vi.fn());
    expect(document.querySelector('[data-ft-owned="reddit-home-settings"]')).toBeNull();
    destroy();
    destroy = undefined;
    route.hostname = 'www.reddit.com';
    route.pathname = '/r/test/';
    route.href = 'https://www.reddit.com/r/test/';
    destroy = mountControls(() => ({ ...DEFAULTS }), vi.fn(), vi.fn());
    const button = document.querySelector<HTMLElement>('[data-ft-owned="reddit-home-settings"]')?.shadowRoot?.querySelector<HTMLButtonElement>('button');
    expect(button?.hidden).toBe(true);
  });
});
