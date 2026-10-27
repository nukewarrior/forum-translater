// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedditRuntime } from '../src/runtime';
import { DEFAULTS } from '../src/settings';
import { TranslationCache, TranslationService } from '../src/translation/service';
import * as reddit from '../src/reddit';

class Observer {
  static instances: Observer[] = [];
  readonly targets = new Set<Element>();
  constructor(readonly callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) { Observer.instances.push(this); }
  observe(target: Element): void { this.targets.add(target); }
  unobserve(target: Element): void { this.targets.delete(target); }
  disconnect(): void { this.targets.clear(); }
  emit(target: Element, isIntersecting = true): void {
    this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}
let runtime: RedditRuntime | undefined;
let service: TranslationService;
beforeEach(() => {
  vi.useFakeTimers(); Observer.instances = [];
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.stubGlobal('GM_getValue', (_key: string, fallback: unknown) => fallback);
  vi.stubGlobal('GM_setValue', vi.fn());
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  document.body.innerHTML = '<shreddit-post id="t3_first"><a slot="title"><h1>Hello world</h1></a></shreddit-post>';
  service = new TranslationService({ ...DEFAULTS, enabled: true }, new TranslationCache());
});
afterEach(() => { runtime?.destroy(); runtime = undefined; service.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.replaceChildren(); });
function title(): HTMLElement { const element = document.querySelector<HTMLElement>('a[slot="title"]'); if (!element) throw new Error('Missing fixture'); return element; }
async function settle(): Promise<void> { await vi.advanceTimersByTimeAsync(150); }

it('keeps Reddit feed titles off by default while allowing detail titles independently', () => {
  vi.stubGlobal('location', { hostname: 'www.reddit.com', pathname: '/', href: 'https://www.reddit.com/' });
  runtime = new RedditRuntime({ ...service.settings, title: true, redditFeedTitle: false }, service);
  expect(Observer.instances[0]?.targets.has(title())).toBe(false);
});

it('keeps English above the Chinese title in default bilingual mode', async () => {
  vi.stubGlobal('location', { hostname: 'www.reddit.com', pathname: '/', href: 'https://www.reddit.com/' });
  title().setAttribute('href', '/r/test/comments/first/hello/');
  const translate = vi.spyOn(service, 'section').mockResolvedValue('你好，世界');
  runtime = new RedditRuntime({ ...service.settings, title: false, redditFeedTitle: true, translationOnly: false }, service);
  Observer.instances[0]?.emit(title()); await settle();
  const box = document.querySelector<HTMLElement>('span[data-ft-owned="translation"].ft-feed-title');
  expect(box?.parentElement).toBe(title());
  expect(box?.previousElementSibling).toBe(title().querySelector('h1'));
  expect(title().textContent).toContain('Hello world');
  expect(title().hasAttribute('data-ft-original-hidden')).toBe(false);
  expect(box?.textContent).toContain('你好，世界');
  expect(translate).toHaveBeenCalledOnce();
});

it('links translated feed titles to Reddit posts in translation-only mode', async () => {
  vi.stubGlobal('location', { hostname: 'www.reddit.com', pathname: '/r/test/', href: 'https://www.reddit.com/r/test/' });
  title().setAttribute('href', '/r/test/comments/first/hello/');
  const translate = vi.spyOn(service, 'section').mockResolvedValue('你好，世界');
  runtime = new RedditRuntime({ ...service.settings, title: false, redditFeedTitle: true, translationOnly: true }, service);
  Observer.instances[0]?.emit(title()); await settle();
  const box = document.querySelector<HTMLElement>('span[data-ft-owned="translation"].ft-feed-title');
  expect(box?.parentElement).toBe(title());
  expect((title() as HTMLAnchorElement).href).toBe('https://www.reddit.com/r/test/comments/first/hello/');
  expect(box?.textContent).toContain('你好，世界');
  expect(title().hasAttribute('data-ft-original-hidden')).toBe(false);
  expect(title().querySelector('h1')?.hasAttribute('data-ft-original-hidden')).toBe(true);
  expect(translate).toHaveBeenCalledOnce();
});

it('projects bilingual and translation-only titles through the original Reddit title slot', async () => {
  vi.stubGlobal('location', { hostname: 'www.reddit.com', pathname: '/r/test/', href: 'https://www.reddit.com/r/test/' });
  const host = document.querySelector<HTMLElement>('shreddit-post');
  if (!host) throw new Error('Missing post');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div><slot name="title"></slot></div>';
  title().setAttribute('slot', 'title');
  title().setAttribute('href', '/r/test/comments/first/hello/');
  const slot = shadow.querySelector<HTMLSlotElement>('slot');
  const translate = vi.spyOn(service, 'section').mockResolvedValue('你好，世界');
  runtime = new RedditRuntime({ ...service.settings, title: false, redditFeedTitle: true, translationOnly: true }, service);
  Observer.instances[0]?.emit(title()); await settle();
  const box = title().querySelector<HTMLElement>('[data-ft-owned="translation"].ft-feed-title');
  expect(box?.textContent).toContain('你好，世界');
  expect(slot?.assignedElements()).toEqual([title()]);
  expect(title().querySelector('h1')?.hasAttribute('data-ft-original-hidden')).toBe(true);
  expect(title().hasAttribute('data-ft-original-hidden')).toBe(false);
  expect(translate).toHaveBeenCalledOnce();
});

it('does not hide feed source links without a safe translated link', async () => {
  vi.stubGlobal('location', { hostname: 'www.reddit.com', pathname: '/', href: 'https://www.reddit.com/' });
  const translate = vi.spyOn(service, 'section').mockResolvedValue('中文译文');
  runtime = new RedditRuntime({ ...service.settings, redditFeedTitle: true, translationOnly: true }, service);
  Observer.instances[0]?.emit(title()); await settle();
  expect(title().hasAttribute('data-ft-original-hidden')).toBe(false);
  expect(document.querySelector('[data-ft-owned="translation"]')?.textContent).toContain('中文译文');
  expect(translate).toHaveBeenCalledOnce();
});

it.each(['google', 'ai'] as const)(
  'reuses a persisted Reddit feed title on its detail page with %s even when context changes',
  async provider => {
    const stored = new Map<string, unknown>();
    vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => stored.get(key) ?? fallback);
    vi.stubGlobal('GM_setValue', (key: string, value: unknown) => { stored.set(key, value); });
    const route = { hostname: 'www.reddit.com', pathname: '/', href: 'https://www.reddit.com/' };
    vi.stubGlobal('location', route);
    const settings = {
      ...DEFAULTS, provider, redditFeedTitle: true, title: true, body: false, comment: false,
      ai: { ...DEFAULTS.ai, baseUrl: 'https://api.example.com/v1', model: 'example-model', prompt: 'Keep names intact' },
    };
    service.destroy();
    service = new TranslationService(settings, new TranslationCache());
    document.body.innerHTML = '<shreddit-post id="virtualized-123" permalink="/r/test/comments/abc123/same-title/"><a id="post-title-t3_abc123" href="/r/test/comments/abc123/same-title/"><h2>Same English title</h2></a></shreddit-post>';
    const listing = document.querySelector<HTMLElement>('a[id^="post-title"]');
    if (!listing) throw new Error('Missing listing fixture');
    expect(reddit.contentIdentity(listing)).toBe('t3_abc123');
    const first = vi.spyOn(service, 'section').mockResolvedValue('同一个中文标题');
    runtime = new RedditRuntime(settings, service);
    Observer.instances[0]?.emit(listing); await settle();
    expect(first).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-ft-owned="translation"]')?.textContent).toContain('同一个中文标题');
    runtime.destroy(); runtime = undefined;
    // The first runtime has flushed the persisted cache, as a real navigation would.
    expect(stored.has('ft:translations:v1')).toBe(true);
    service.destroy(); Observer.instances = [];
    route.pathname = '/r/test/comments/abc123/same-title/';
    route.href = 'https://www.reddit.com/r/test/comments/abc123/same-title/';
    document.body.innerHTML = '<shreddit-post thingid="t3_abc123"><a slot="title"><h1>Same English title</h1></a><div slot="text-body"><p>Extra post context only available on the detail page.</p></div></shreddit-post>';
    service = new TranslationService(settings, new TranslationCache());
    const second = vi.spyOn(service, 'section').mockRejectedValue(new Error('Cache miss unexpectedly translated again'));
    runtime = new RedditRuntime(settings, service);
    Observer.instances[0]?.emit(title()); await settle();
    expect(reddit.contentIdentity(title())).toBe('t3_abc123');
    expect(second).not.toHaveBeenCalled();
    expect(document.querySelector('[data-ft-owned="translation"]')?.textContent).toContain('同一个中文标题');
  }
);

it('does not reuse a feed title cached for a different Reddit post ID', async () => {
  const stored = new Map<string, unknown>();
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => stored.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => { stored.set(key, value); });
  const route = { hostname: 'www.reddit.com', pathname: '/', href: 'https://www.reddit.com/' };
  vi.stubGlobal('location', route);
  const settings = { ...DEFAULTS, redditFeedTitle: true, title: true, body: false, comment: false };
  service.destroy(); service = new TranslationService(settings, new TranslationCache());
  document.body.innerHTML = '<shreddit-post post-id="abc123"><a slot="title" href="/r/test/comments/abc123/">Same English title</a></shreddit-post>';
  const first = vi.spyOn(service, 'section').mockResolvedValue('第一篇译文');
  runtime = new RedditRuntime(settings, service);
  Observer.instances[0]?.emit(title()); await settle();
  expect(first).toHaveBeenCalledOnce();
  runtime.destroy(); runtime = undefined; service.destroy(); Observer.instances = [];
  route.pathname = '/r/test/comments/different/';
  route.href = 'https://www.reddit.com/r/test/comments/different/';
  document.body.innerHTML = '<shreddit-post post-id="different"><a slot="title"><h1>Same English title</h1></a></shreddit-post>';
  service = new TranslationService(settings, new TranslationCache());
  const next = vi.spyOn(service, 'section').mockResolvedValue('第二篇译文');
  runtime = new RedditRuntime(settings, service);
  Observer.instances[0]?.emit(title()); await settle();
  // Paragraph-cache entries must never be reused across distinct post IDs.
  expect(next).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-ft-owned="translation"]')?.textContent).toContain('第二篇译文');
});

it('retains completed background translations during a swipe and fills them once scrolling settles', async () => {
  let partial!: (text: string) => void; let finish!: (text: string) => void;
  const translate = vi.spyOn(service, 'section').mockImplementation((_text, _owner, _priority, _signal, onPartial) => {
    if (!onPartial) throw new Error('Missing streaming callback');
    partial = onPartial; return new Promise(resolve => { finish = resolve; });
  });
  runtime = new RedditRuntime(service.settings, service);
  Observer.instances[0]?.emit(title()); await settle();
  const box = document.querySelector('[data-ft-owned="translation"]');
  const placeholder = box?.firstChild;
  window.dispatchEvent(new TouchEvent('touchstart'));
  partial('部分译文'); finish('完整译文'); await settle();
  expect(box?.firstChild).toBe(placeholder); expect(box?.textContent).not.toContain('译文');
  window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
  window.dispatchEvent(new Event('scroll'));
  await vi.advanceTimersByTimeAsync(160);
  expect(box?.textContent).toBe('完整译文'); expect(translate).toHaveBeenCalledOnce();
  Observer.instances[0]?.emit(title()); await settle();
  expect(translate).toHaveBeenCalledOnce();
});


it('starts newly visible translation requests during ongoing touch scrolling, without painting mid-gesture', async () => {
  const translate = vi.spyOn(service, 'section').mockResolvedValue('新译文');
  runtime = new RedditRuntime(service.settings, service);
  window.dispatchEvent(new TouchEvent('touchstart'));
  Observer.instances[1]?.emit(title(), true);
  await Promise.resolve();
  expect(translate).toHaveBeenCalledOnce();
  expect(translate.mock.calls[0]?.[2]).toBe('visible');
  // Network work is allowed during scroll; DOM painting remains coalesced.
  expect(document.querySelector('[data-ft-owned="translation"]')?.textContent).not.toContain('新译文');
  window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
  await vi.advanceTimersByTimeAsync(170);
  expect(document.querySelector('[data-ft-owned="translation"]')?.textContent).toBe('新译文');
});

it('discovers Reddit comments appended during continuous scrolling rather than waiting for scroll idle', async () => {
  const translate = vi.spyOn(service, 'section').mockResolvedValue('滚动中完成');
  runtime = new RedditRuntime({ ...service.settings, title: false }, service);
  window.dispatchEvent(new TouchEvent('touchstart'));
  const node = document.createElement('shreddit-comment');
  node.innerHTML = '<div slot="comment"><p>New visible Reddit comment.</p></div>';
  const body = node.querySelector<HTMLElement>('[slot="comment"]');
  if (!body) throw new Error('Missing test comment');
  vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 30, top: 30, bottom: 80, left: 0, right: 300,
    width: 300, height: 50, toJSON: () => ({}),
  });
  document.body.append(node);
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(18);
  expect(translate).toHaveBeenCalledOnce();
  expect(translate.mock.calls[0]?.[2]).toBe('visible');
  window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
  await vi.advanceTimersByTimeAsync(170);
  expect(node.textContent).toContain('滚动中完成');
});

it('reuses the source snapshot and section nodes while streaming, then rejects changed host content', async () => {
  let partial: ((value: string) => void) | undefined; let finish: ((value: string) => void) | undefined;
  const translate = vi.spyOn(service, 'section').mockResolvedValue('新译文').mockImplementationOnce((_text, _owner, _priority, _signal, onPartial) => {
    partial = onPartial; return new Promise(resolve => { finish = resolve; });
  });
  runtime = new RedditRuntime(service.settings, service); Observer.instances[0]?.emit(title()); await settle();
  const snapshot = vi.spyOn(reddit, 'sourceSnapshot');
  partial?.('流式译文'); await settle();
  const box = document.querySelector('[data-ft-owned="translation"]'); const paragraph = box?.firstChild; const text = paragraph?.firstChild;
  partial?.('流式译文'); await settle();
  expect(box?.firstChild).toBe(paragraph); expect(paragraph?.firstChild).toBe(text);
  expect(snapshot).not.toHaveBeenCalled(); expect(translate).toHaveBeenCalledOnce();
  const source = title(); const sibling = document.createElement('shreddit-post'); sibling.innerHTML = '<a slot="title">Unrelated loaded post</a>';
  document.body.append(sibling); await settle(); partial?.('流式译文继续'); await settle();
  expect(box?.firstChild).toBe(paragraph); expect(snapshot.mock.calls.filter(([element]) => element === source)).toHaveLength(0);
  expect(translate).toHaveBeenCalledOnce();
  const heading = title().querySelector('h1'); if (!heading) throw new Error('Missing heading');
  heading.textContent = 'Updated source'; finish?.('旧译文'); await settle();
  expect(document.querySelector('[data-ft-owned="translation"]')?.textContent).toBe('新译文');
  expect(document.body.textContent).not.toContain('旧译文'); expect(translate).toHaveBeenCalledTimes(2);
});
it('changes the translation theme without replacing text or issuing translation requests', async () => {
  const translate = vi.spyOn(service, 'section').mockResolvedValue('你好');
  runtime = new RedditRuntime(service.settings, service); Observer.instances[0]?.emit(title()); await settle();
  const box = document.querySelector<HTMLElement>('[data-ft-owned="translation"]');
  runtime.setTranslationTheme('paper'); expect(box?.dataset.translationTheme).toBe('paper');
  expect(box?.textContent).toBe('你好'); expect(translate).toHaveBeenCalledOnce();
});
it('renders unchanged X paragraphs immediately after expansion while only the new text waits', async () => {
  document.body.innerHTML = '<article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a><div data-testid="tweetText">First paragraph</div></article>';
  const root = document.querySelector<HTMLElement>('[data-testid="tweetText"]'); if (!root) throw new Error('Missing tweet');
  let complete: ((value: string) => void) | undefined;
  const translate = vi.spyOn(service, 'section').mockResolvedValueOnce('已有译文').mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  runtime = new RedditRuntime({ ...service.settings, translationOnly: true }, service);
  Observer.instances[0]?.emit(root); await settle();
  root.textContent = 'First paragraph\n\nNew paragraph'; await settle();
  expect(translate).toHaveBeenCalledTimes(2); expect(translate.mock.calls[1]?.[0]).toBe('New paragraph');
  expect(root.textContent).toContain('已有译文');
  expect(root.querySelector('[data-ft-original-hidden]')?.textContent).toBe('First paragraph');
  expect(root.querySelector('.hnr-translation-placeholder')).not.toBeNull();
  complete?.('新增译文'); await settle();
  expect(root.textContent).toContain('已有译文'); expect(root.textContent).toContain('新增译文');
});
it('paints persisted feed translations in a fresh detail runtime before new paragraphs resolve', async () => {
  const stored = new Map<string, unknown>();
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => stored.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => { stored.set(key, value); });
  document.body.innerHTML = '<article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a><div data-testid="tweetText">First paragraph\n\nCut off...</div></article>';
  const translate = vi.spyOn(service, 'section').mockResolvedValueOnce('已有译文').mockResolvedValueOnce('截断旧译文');
  runtime = new RedditRuntime({ ...service.settings }, service);
  const feed = document.querySelector('[data-testid="tweetText"]'); if (!feed) throw new Error('Missing feed');
  Observer.instances[0]?.emit(feed); await settle(); expect(translate).toHaveBeenCalledTimes(2);
  runtime.destroy(); Observer.instances = [];
  document.body.innerHTML = '<article data-testid="tweet"><a href="https://x.com/user/status/123?ref=detail"><time>Now</time></a><div data-testid="tweetText"><strong>First paragraph</strong>\n\nCut off sentence now complete.\n\nNew paragraph</div></article>';
  service = new TranslationService({ ...DEFAULTS }, new TranslationCache());
  const pending = vi.spyOn(service, 'section').mockImplementation(() => new Promise(() => {}));
  runtime = new RedditRuntime(service.settings, service);
  const detail = document.querySelector('[data-testid="tweetText"]'); if (!detail) throw new Error('Missing detail');
  Observer.instances[0]?.emit(detail);
  await settle();
  expect(detail.textContent).toContain('已有译文');
  expect(detail.textContent).toContain('截断旧译文');
  expect(pending.mock.calls.map(call => call[0])).toEqual(['Cut off sentence now complete.', 'New paragraph']);
});
it('retranslates a completed truncated paragraph when expansion changes its text', async () => {
  document.body.innerHTML = '<shreddit-post id="t3_post"><div slot="text-body"><p>Unchanged paragraph</p><p>Cut off...</p></div></shreddit-post>';
  const root = document.querySelector<HTMLElement>('[slot="text-body"]'); if (!root) throw new Error('Missing body');
  const translate = vi.spyOn(service, 'section').mockResolvedValueOnce('保留译文').mockResolvedValueOnce('截断译文').mockResolvedValueOnce('完整译文');
  runtime = new RedditRuntime({ ...service.settings }, service); Observer.instances[0]?.emit(root); await settle();
  root.innerHTML = '<p>Unchanged paragraph</p><p>Cut off sentence now complete.</p>'; await settle();
  expect(translate).toHaveBeenCalledTimes(3); expect(translate.mock.calls[2]?.[0]).toBe('Cut off sentence now complete.');
  expect(root.textContent).toContain('保留译文'); expect(root.textContent).toContain('完整译文'); expect(root.textContent).not.toContain('截断译文');
});
it('does not reuse another tweet translation when a virtual node changes post identity', async () => {
  document.body.innerHTML = '<article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a><div data-testid="tweetText">Same paragraph</div></article>';
  const root = document.querySelector<HTMLElement>('[data-testid="tweetText"]'); if (!root) throw new Error('Missing tweet');
  const translate = vi.spyOn(service, 'section').mockResolvedValueOnce('原帖译文').mockResolvedValueOnce('另一帖译文');
  runtime = new RedditRuntime({ ...service.settings }, service); Observer.instances[0]?.emit(root); await settle();
  document.querySelector('time')?.closest('a')?.setAttribute('href', '/user/status/456');
  root.textContent = 'Same paragraph'; await settle(); Observer.instances[0]?.emit(root); await settle();
  expect(translate).toHaveBeenCalledTimes(2); expect(document.body.textContent).not.toContain('原帖译文');
});


describe('viewport translation lifecycle', () => {
  it('moves foreground priority to the next unfinished visible post as soon as the first completes', async () => {
    document.body.innerHTML = '<shreddit-post id="one"><div slot="text-body">First visible post</div></shreddit-post><shreddit-post id="two"><div slot="text-body">Second visible post</div></shreddit-post>';
    const roots = [...document.querySelectorAll('[slot="text-body"]')];
    roots.forEach((root, index) => { root.getBoundingClientRect = () => ({ x: 0, y: 20 + index * 200, top: 20 + index * 200, bottom: 80 + index * 200, left: 0, right: 300, width: 300, height: 60, toJSON: () => ({}) }); });
    let completeFirst: ((value: string) => void) | undefined; let completeSecond: ((value: string) => void) | undefined;
    const translate = vi.spyOn(service, 'section').mockImplementationOnce(() => new Promise(resolve => { completeFirst = resolve; })).mockImplementationOnce(() => new Promise(resolve => { completeSecond = resolve; }));
    const foreground = vi.spyOn(service, 'setForeground');
    runtime = new RedditRuntime({ ...service.settings }, service);
    await settle();
    expect(foreground).toHaveBeenLastCalledWith(translate.mock.calls[0]?.[1]);
    completeFirst?.('第一条译文'); await settle();
    expect(foreground).toHaveBeenLastCalledWith(translate.mock.calls[1]?.[1]);
    completeSecond?.('第二条译文'); await settle(); expect(foreground).toHaveBeenLastCalledWith(undefined);
  });
  it('starts already visible text on the next task without an observer callback', async () => {
    vi.spyOn(title(), 'getBoundingClientRect').mockReturnValue({ x: 0, y: 20, top: 20, bottom: 60, left: 0, right: 300, width: 300, height: 40, toJSON: () => ({}) });
    const translate = vi.spyOn(service, 'section').mockResolvedValue('译文');
    runtime = new RedditRuntime(service.settings, service);
    await vi.advanceTimersByTimeAsync(1);
    expect(translate).toHaveBeenCalledOnce();
    expect(translate.mock.calls[0]?.[2]).toBe('visible');
  });
  it('yields after discovery before starting newly loaded visible text', async () => {
    const translate = vi.spyOn(service, 'section').mockResolvedValue('译文');
    runtime = new RedditRuntime({ ...service.settings, title: false }, service);
    const post = document.createElement('shreddit-post'); post.innerHTML = '<div slot="text-body"><p>New visible post</p></div>';
    const body = post.querySelector<HTMLElement>('[slot="text-body"]'); if (!body) throw new Error('Missing body');
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 20, top: 20, bottom: 60, left: 0, right: 300, width: 300, height: 40, toJSON: () => ({}) });
    document.body.append(post); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(17);
    expect(translate).toHaveBeenCalledOnce();
    expect(translate.mock.calls[0]?.[2]).toBe('visible');
  });
  it('does no translation before intersection and preserves a title slot outside its native link', async () => {
    const translate = vi.spyOn(service, 'section').mockResolvedValue('你好，世界');
    const element = title(); const before = element.outerHTML;
    runtime = new RedditRuntime(service.settings, service);
    expect(translate).not.toHaveBeenCalled();
    expect(Observer.instances[0]?.options?.rootMargin).toBe('600px 0px 1200px 0px');
    Observer.instances[0]?.emit(element); await settle();
    const box = element.nextElementSibling;
    expect(box?.textContent).toBe('你好，世界'); expect(box?.getAttribute('slot')).toBe('title');
    expect(element.outerHTML).toBe(before); expect(translate).toHaveBeenCalledTimes(1);
    await settle(); expect(translate).toHaveBeenCalledTimes(1);
  });
  it('discovers added comments and excludes disabled types', async () => {
    const translate = vi.spyOn(service, 'section').mockResolvedValue('译文');
    runtime = new RedditRuntime({ ...service.settings, title: false }, service);
    expect(Observer.instances[0]?.targets.size).toBe(0);
    const comment = document.createElement('shreddit-comment'); comment.innerHTML = '<div slot="comment"><p>New comment text</p></div>'; document.body.append(comment);
    await settle(); const body = comment.querySelector<HTMLElement>('[slot="comment"]');
    expect(body).not.toBeNull(); if (!body) return;
    expect(Observer.instances[0]?.targets.has(body)).toBe(true); expect(translate).not.toHaveBeenCalled();
    Observer.instances[1]?.emit(body); await settle();
    expect(translate.mock.calls[0]?.[2]).toBe('visible');
    expect(comment.querySelector('[data-ft-owned]')?.textContent).toBe('译文');
  });
  it('discards late results when a DOM node is reused with changed text', async () => {
    let resolve: ((value: string) => void) | undefined;
    vi.spyOn(service, 'section').mockImplementationOnce(() => new Promise<string>(done => { resolve = done; })).mockResolvedValue('新译文');
    runtime = new RedditRuntime(service.settings, service); const element = title();
    Observer.instances[0]?.emit(element); await settle();
    element.textContent = 'Completely changed content';
    resolve?.('过期译文'); await settle();
    expect(document.body.textContent).not.toContain('过期译文');
    Observer.instances[0]?.emit(element); await settle(); expect(document.body.textContent).toContain('新译文');
  });
  it('finishes in the background outside the buffer and reuses completed page translations', async () => {
    let resolve: ((value: string) => void) | undefined;
    const translate = vi.spyOn(service, 'section').mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
    runtime = new RedditRuntime(service.settings, service); const element = title();
    Observer.instances[0]?.emit(element); await settle();
    const signal = translate.mock.calls[0]?.[3];
    Observer.instances[0]?.emit(element, false);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'));
    expect(signal?.aborted).toBe(false);
    resolve?.('后台译文'); await settle();
    expect(document.body.textContent).toContain('后台译文');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
    Observer.instances[0]?.emit(element); await settle();
    expect(translate).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('后台译文');
  });
  it('keeps failures local, supports retry, and removes translations on destroy', async () => {
    const translate = vi.spyOn(service, 'section').mockRejectedValueOnce(new Error('offline')).mockResolvedValue('重试成功');
    runtime = new RedditRuntime(service.settings, service); Observer.instances[0]?.emit(title()); await settle();
    document.querySelector<HTMLButtonElement>('[data-ft-owned] button')?.click(); await settle();
    expect(translate.mock.calls[1]?.[2]).toBe('interactive'); expect(document.body.textContent).toContain('重试成功');
    runtime.destroy(); expect(document.querySelector('[data-ft-owned]')).toBeNull();
  });
  it('places each paragraph translation immediately below its original and cleans up on destroy', async () => {
    document.body.innerHTML = '<shreddit-post><div slot="text-body"><p id="first">First paragraph.</p><p id="second">Second paragraph.</p></div></shreddit-post>';
    vi.spyOn(service, 'section').mockImplementation(text => Promise.resolve(text.includes('First') ? '第一段译文' : '第二段译文'));
    runtime = new RedditRuntime(service.settings, service);
    const body = document.querySelector('[slot="text-body"]'); if (!body) throw new Error('Missing body');
    Observer.instances[0]?.emit(body); await settle();
    expect(document.querySelector('#first')?.nextElementSibling?.textContent).toBe('第一段译文');
    expect(document.querySelector('#second')?.nextElementSibling?.textContent).toBe('第二段译文');
    expect(document.querySelector('#first')?.textContent).toBe('First paragraph.');
    runtime.destroy(); expect(document.querySelector('[data-ft-owned]')).toBeNull();
  });
  it('hides originals only after success and restores them on shutdown', async () => {
    service.destroy(); service = new TranslationService({ ...DEFAULTS, translationOnly: true }, new TranslationCache());
    document.body.innerHTML = '<shreddit-post><div slot="text-body"><p id="first">First paragraph.</p><p id="second">Second paragraph.</p></div></shreddit-post>';
    let complete: ((value: string) => void) | undefined;
    vi.spyOn(service, 'section').mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockRejectedValueOnce(new Error('offline'));
    runtime = new RedditRuntime(service.settings, service);
    const body = document.querySelector('[slot="text-body"]'); if (!body) throw new Error('Missing body');
    Observer.instances[0]?.emit(body); await settle();
    expect(document.querySelector('#first')?.hasAttribute('data-ft-original-hidden')).toBe(false);
    complete?.('第一段译文'); await settle();
    expect(document.querySelector('#first')?.hasAttribute('data-ft-original-hidden')).toBe(true);
    expect(document.querySelector('#second')?.hasAttribute('data-ft-original-hidden')).toBe(false);
    expect(document.querySelector('#first')?.nextElementSibling?.textContent).toBe('第一段译文');
    runtime.destroy(); expect(document.querySelector('[data-ft-original-hidden]')).toBeNull();
    expect(document.querySelector('#first')?.textContent).toBe('First paragraph.');
  });
  it('starts translating existing comments when aria-expanded changes without inserting DOM', async () => {
    const translate = vi.spyOn(service, 'section').mockResolvedValue('展开译文');
    document.body.innerHTML = '<shreddit-comment aria-expanded="false"><div slot="comment">Existing collapsed text.</div></shreddit-comment>';
    runtime = new RedditRuntime(service.settings, service);
    const text = document.querySelector('[slot="comment"]'); if (!text) throw new Error('Missing comment');
    Observer.instances[0]?.emit(text); await settle(); expect(translate).not.toHaveBeenCalled();
    text.parentElement?.setAttribute('aria-expanded', 'true'); await settle();
    expect(translate).toHaveBeenCalledOnce(); expect(text.nextElementSibling?.textContent).toBe('展开译文');
  });
  it('rescans only the clicked comment after expansion with no observable light-DOM attribute', async () => {
    const translate = vi.spyOn(service, 'section').mockResolvedValue('展开译文');
    document.body.innerHTML = '<shreddit-comment><button>Expand</button><div slot="comment">Existing text.</div></shreddit-comment>';
    let open = false;
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => (open ? [{}] : []) as unknown as DOMRectList);
    runtime = new RedditRuntime(service.settings, service);
    const text = document.querySelector('[slot="comment"]'); if (!text) throw new Error('Missing comment');
    Observer.instances[0]?.emit(text); await settle(); expect(translate).not.toHaveBeenCalled();
    open = true; document.querySelector('button')?.click(); await settle();
    expect(translate).toHaveBeenCalledOnce();
    document.querySelector('button')?.click(); await settle(); expect(translate).toHaveBeenCalledOnce();
  });
  it('does not translate collapsed comments', async () => {
    const translate = vi.spyOn(service, 'section').mockResolvedValue('译文');
    document.body.innerHTML = '<shreddit-comment collapsed><div slot="comment">Hidden content</div></shreddit-comment>';
    runtime = new RedditRuntime(service.settings, service);
    const element = document.querySelector('[slot="comment"]'); if (!element) throw new Error('Missing comment');
    Observer.instances[0]?.emit(element); await settle(); expect(translate).not.toHaveBeenCalled();
    element.parentElement?.removeAttribute('collapsed'); await settle(); expect(translate).toHaveBeenCalledOnce();
  });
});

it('keeps translation-only active across paragraph failure and retries only that paragraph', async () => {
  document.body.innerHTML = '<shreddit-post><div slot="text-body"><p id="first">First paragraph.</p><p id="second">Second paragraph.</p><p id="third">Third paragraph.</p></div></shreddit-post>';
  const translate = vi.spyOn(service, 'section').mockResolvedValueOnce('第一段译文').mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(() => new Promise<string>(() => {})).mockResolvedValueOnce('第二段译文');
  runtime = new RedditRuntime({ ...service.settings, translationOnly: true }, service);
  const body = document.querySelector('[slot="text-body"]'); if (!body) throw new Error('Missing body');
  Observer.instances[0]?.emit(body); await settle();
  expect(document.querySelector('#first')?.hasAttribute('data-ft-original-hidden')).toBe(true);
  expect(document.querySelector('#second')?.hasAttribute('data-ft-original-hidden')).toBe(false);
  expect(document.querySelector('#third')?.hasAttribute('data-ft-original-hidden')).toBe(false);
  const retry = document.querySelector<HTMLButtonElement>('#second + [data-ft-owned] button');
  expect(retry?.textContent).toBe('重试本段'); retry?.click(); retry?.click(); await settle();
  expect(translate).toHaveBeenCalledTimes(4);
  expect(translate.mock.calls[3]?.[0]).toContain('Second');
  expect(document.querySelector('#second')?.hasAttribute('data-ft-original-hidden')).toBe(true);
  expect(document.querySelector('#first')?.nextElementSibling?.textContent).toBe('第一段译文');
});

it('updates the browser tab from the completed post title without an extra request', async () => {
  history.replaceState(null, '', '/r/test/comments/abc/post/'); document.title = 'Hello world : r/test';
  const translate = vi.spyOn(service, 'section').mockResolvedValue('你好，世界');
  runtime = new RedditRuntime(service.settings, service);
  Observer.instances[0]?.emit(title()); await settle();
  expect(document.title).toBe('你好，世界 : r/test'); expect(translate).toHaveBeenCalledOnce();
  runtime.destroy(); expect(document.title).toBe('Hello world : r/test');
  history.replaceState(null, '', '/'); document.title = '';
});

it('translates an X tweet and a reused virtualized tweet node, preserving its media', async () => {
  document.body.innerHTML = '<article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a><div data-testid="tweetText">First tweet</div><video></video></article>';
  vi.spyOn(service, 'section').mockResolvedValueOnce('第一条推文').mockResolvedValueOnce('第二条推文');
  runtime = new RedditRuntime({ ...service.settings, translationOnly: true }, service);
  const tweet = document.querySelector<HTMLElement>('[data-testid="tweetText"]'); if (!tweet) throw new Error('Missing tweet');
  Observer.instances[0]?.emit(tweet); await settle();
  expect(tweet.nextElementSibling?.textContent).toBe('第一条推文'); expect(tweet.hasAttribute('data-ft-original-hidden')).toBe(true);
  expect(document.querySelector('video')?.closest('[data-ft-original-hidden]')).toBeNull();
  tweet.textContent = 'Second tweet'; document.querySelector('a')?.setAttribute('href', '/user/status/456');
  await settle(); Observer.instances[0]?.emit(tweet); await settle();
  expect(tweet.nextElementSibling?.textContent).toBe('第二条推文');
  expect(document.body.textContent).not.toContain('第一条推文');
});

it('skips Chinese tweets including site-labelled Chinese with product names', async () => {
  document.body.innerHTML = '<article data-testid="tweet"><div data-testid="tweetText">谢谢</div></article><article data-testid="tweet"><div data-testid="tweetText" lang="zh">用 ChatGPT</div></article><article data-testid="tweet"><div data-testid="tweetText" lang="en">Hello world</div></article>';
  const translate = vi.spyOn(service, 'section').mockResolvedValue('你好，世界');
  runtime = new RedditRuntime(service.settings, service);
  for (const element of document.querySelectorAll('[data-testid="tweetText"]')) Observer.instances[0]?.emit(element);
  await settle(); expect(translate).toHaveBeenCalledOnce(); expect(translate.mock.calls[0]?.[0]).toBe('Hello world');
});
it('translates only foreign paragraphs when most of a post is already Chinese', async () => {
  document.body.innerHTML = '<shreddit-post><div slot="text-body"><p id="chinese">这一段内容本来就是中文，不需要再次翻译。</p><p id="foreign">Hello world</p></div></shreddit-post>';
  const translate = vi.spyOn(service, 'section').mockResolvedValue('你好，世界');
  runtime = new RedditRuntime({ ...service.settings, translationOnly: true }, service);
  const body = document.querySelector('[slot="text-body"]'); if (!body) throw new Error('Missing body');
  Observer.instances[0]?.emit(body); await settle();
  expect(translate).toHaveBeenCalledOnce(); expect(translate.mock.calls[0]?.[0]).toBe('Hello world');
  expect(document.querySelector('#chinese')?.hasAttribute('data-ft-original-hidden')).toBe(false);
  expect(document.querySelector('#foreign')?.hasAttribute('data-ft-original-hidden')).toBe(true);
});

it('keeps paragraph-end translations outside links and stable across reconciliation', async () => {
  document.body.innerHTML = '<article data-testid="tweet"><div data-testid="tweetText"><span>First paragraph\n\nRepo: </span><a href="https://example.com">example.com</a></div></article>';
  const root = document.querySelector<HTMLElement>('[data-testid="tweetText"]'); if (!root) throw new Error('Missing tweet');
  const translate = vi.spyOn(service, 'section').mockImplementation(text => Promise.resolve(text.startsWith('First') ? '第一段' : '仓库 ⟦0⟧'));
  runtime = new RedditRuntime(service.settings, service); Observer.instances[0]?.emit(root); await settle();
  expect(root.querySelector('a [data-ft-owned]')).toBeNull();
  expect(root.querySelectorAll('[data-ft-owned="translation"]')).toHaveLength(2);
  root.classList.add('host-update'); await settle();
  expect(translate).toHaveBeenCalledTimes(2);
});
it('inserts each X translation after its paragraph, preserving links and single line breaks', async () => {
  document.body.innerHTML = '<article data-testid="tweet"><div data-testid="tweetText"><span>First paragraph\n\nSecond <a href="https://example.com">link</a> line\nstill second\n\nThird paragraph</span></div></article>';
  const root = document.querySelector<HTMLElement>('[data-testid="tweetText"]'); if (!root) throw new Error('Missing tweet');
  const original = root.innerHTML; const link = root.querySelector('a');
  const translate = vi.spyOn(service, 'section').mockImplementation(text => Promise.resolve(text.startsWith('First') ? '第一段' : text.startsWith('Second') ? '第二段 ⟦0⟧' : '第三段'));
  runtime = new RedditRuntime(service.settings, service); Observer.instances[0]?.emit(root); await settle();
  expect(translate).toHaveBeenCalledTimes(3);
  expect(root.textContent).toContain('First paragraph第一段\n\nSecond');
  expect(root.textContent).toContain('still second第二段');
  const hiddenSeparators = [...root.querySelectorAll('[data-ft-original-hidden]')];
  expect(hiddenSeparators).toHaveLength(2);
  expect(hiddenSeparators.every(node => /^\s+$/.test(node.textContent ?? ''))).toBe(true);
  expect(root.querySelector('a')).toBe(link);
  expect(translate.mock.calls[0]?.[5]?.post).toContain('Third paragraph');
  expect(translate.mock.calls[1]?.[5]?.post).toBe(translate.mock.calls[0]?.[5]?.post);
  runtime.destroy(); expect(root.innerHTML).toBe(original); expect(root.querySelector('a')).toBe(link);
});
it('hides only completed X paragraphs and restores original text after teardown', async () => {
  document.body.innerHTML = '<article data-testid="tweet"><div data-testid="tweetText"><span>First paragraph\n\nSecond paragraph</span></div></article>';
  const root = document.querySelector<HTMLElement>('[data-testid="tweetText"]'); if (!root) throw new Error('Missing tweet');
  const original = root.innerHTML;
  vi.spyOn(service, 'section').mockResolvedValueOnce('第一段').mockRejectedValueOnce(new Error('offline'));
  runtime = new RedditRuntime({ ...service.settings, translationOnly: true }, service); Observer.instances[0]?.emit(root); await settle();
  expect(root.querySelector('[data-ft-original-hidden]')?.textContent).toBe('First paragraph');
  expect(root.textContent).toContain('Second paragraph'); expect(root.querySelector('button')?.textContent).toBe('重试本段');
  runtime.destroy(); expect(root.innerHTML).toBe(original);
});

it('handles BR paragraph boundaries and hides both translated X paragraphs', async () => {
  document.body.innerHTML = '<article data-testid="tweet"><div data-testid="tweetText">First line<br>Same paragraph<br><br>Second paragraph</div></article>';
  const root = document.querySelector<HTMLElement>('[data-testid="tweetText"]'); if (!root) throw new Error('Missing tweet');
  const original = root.innerHTML;
  const translate = vi.spyOn(service, 'section').mockResolvedValueOnce('第一段').mockResolvedValueOnce('第二段');
  runtime = new RedditRuntime({ ...service.settings, translationOnly: true }, service); Observer.instances[0]?.emit(root); await settle();
  expect(translate).toHaveBeenCalledTimes(2);
  expect([...root.querySelectorAll('[data-ft-original-hidden]')].map(node => node.textContent).join('')).toContain('Second paragraph');
  expect(root.querySelectorAll('[data-ft-owned="translation"]')).toHaveLength(2);
  runtime.destroy(); expect(root.innerHTML).toBe(original);
});

it('reuses AI translations and replaces expanded previews only on completion', async () => {
  service.destroy();
  service = new TranslationService({ ...DEFAULTS, provider: 'ai' }, new TranslationCache());
  document.body.innerHTML = '<article data-testid="tweet"><a href="/user/status/456"><time>Now</time></a><div data-testid="tweetText">First paragraph\n\nWe will continue until other</div></article>';
  const root = document.querySelector<HTMLElement>('[data-testid="tweetText"]'); if (!root) throw new Error('Missing tweet');
  let complete: ((value: string) => void) | undefined;
  let reject: ((reason: Error) => void) | undefined;
  let partial: ((value: string) => void) | undefined;
  const translate = vi.spyOn(service, 'section').mockResolvedValueOnce('首段译文').mockResolvedValueOnce('我们会继续，直到其他');
  runtime = new RedditRuntime(service.settings, service); Observer.instances[0]?.emit(root); await settle();
  translate.mockImplementation((text, _owner, _priority, _signal, onPartial) => {
    if (text === 'New paragraph') return Promise.resolve('新段落译文');
    partial = onPartial;
    return new Promise((resolve, fail) => { complete = resolve; reject = fail; });
  });
  root.textContent = 'First paragraph\n\nWe will continue until other labs improve.\n\nNew paragraph'; await settle();
  expect(translate.mock.calls.slice(2).map(call => call[0])).toEqual(['We will continue until other labs improve.', 'New paragraph']);
  expect(root.textContent).toContain('首段译文'); expect(root.textContent).toContain('我们会继续，直到其他'); expect(root.textContent).toContain('新段落译文');
  const firstBox = root.querySelector('[data-ft-owned="translation"]');
  partial?.('新的流式半句'); await settle();
  expect(root.textContent).not.toContain('新的流式半句'); expect(root.textContent).toContain('我们会继续，直到其他');
  reject?.(new Error('temporary failure')); await settle();
  expect(root.textContent).toContain('我们会继续，直到其他');
  const retry = [...root.querySelectorAll('button')].find(button => button.textContent === '重试本段');
  expect(retry).toBeDefined(); retry?.click();
  complete?.('我们会继续这样做，直到其他实验室改进。'); await settle();
  expect(root.textContent).toContain('我们会继续这样做，直到其他实验室改进。');
  expect(root.textContent).not.toContain('我们会继续，直到其他');
  expect(root.querySelector('[data-ft-owned="translation"]')).toBe(firstBox);
});
it('does not preview a prefix from another post or for a rewritten paragraph', async () => {
  document.body.innerHTML = '<article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a><div data-testid="tweetText">Original truncated paragraph</div></article>';
  const root = document.querySelector<HTMLElement>('[data-testid="tweetText"]'); if (!root) throw new Error('Missing tweet');
  vi.spyOn(service, 'section').mockResolvedValueOnce('旧帖译文').mockImplementation(() => new Promise(() => {}));
  runtime = new RedditRuntime({ ...service.settings }, service); Observer.instances[0]?.emit(root); await settle();
  root.textContent = 'Completely rewritten paragraph'; await settle();
  expect(document.body.textContent).not.toContain('旧帖译文');
  document.querySelector('a')?.setAttribute('href', '/user/status/999');
  root.textContent = 'Original truncated paragraph now expanded'; await settle(); Observer.instances[0]?.emit(root); await settle();
  expect(document.body.textContent).not.toContain('旧帖译文');
});
it('retains X translation nodes across Post open and close', async () => {
  const route = { hostname: 'x.com', href: 'https://x.com/home', pathname: '/home' }; vi.stubGlobal('location', route);
  document.body.innerHTML = '<article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a><div data-testid="tweetText">Original paragraph</div></article>';
  const translate = vi.spyOn(service, 'section').mockResolvedValue('原有译文'); const reset = vi.spyOn(service, 'resetPending');
  runtime = new RedditRuntime({ ...service.settings }, service);
  const root = document.querySelector('[data-testid="tweetText"]'); if (!root) throw new Error('Missing tweet'); Observer.instances[0]?.emit(root); await settle();
  const boxes = [...document.querySelectorAll('[data-ft-owned="translation"]')];
  route.href = 'https://x.com/user/status/123'; route.pathname = '/user/status/123'; window.dispatchEvent(new PopStateEvent('popstate')); await settle();
  route.href = 'https://x.com/home'; route.pathname = '/home'; window.dispatchEvent(new PopStateEvent('popstate')); await settle();
  expect([...document.querySelectorAll('[data-ft-owned="translation"]')]).toEqual(boxes);
  expect(translate).toHaveBeenCalledOnce(); expect(reset).not.toHaveBeenCalled();
});
it('keeps an in-flight feed translation mounted while a native Post modal hides its background', async () => {
  const route = { hostname: 'x.com', href: 'https://x.com/home', pathname: '/home' }; vi.stubGlobal('location', route);
  document.body.innerHTML = '<main data-ft-x-post-background><article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a><div data-testid="tweetText">Original paragraph</div></article></main>';
  let complete: ((value: string) => void) | undefined;
  const translate = vi.spyOn(service, 'section').mockImplementation(() => new Promise<string>(resolve => { complete = resolve; }));
  runtime = new RedditRuntime({ ...service.settings }, service);
  const root = document.querySelector('[data-testid="tweetText"]'); const feed = document.querySelector('main'); if (!root || !feed) throw new Error('Missing feed');
  Observer.instances[0]?.emit(root); await settle();
  const box = feed.querySelector('[data-ft-owned="translation"]'); expect(box).not.toBeNull();
  route.href = 'https://x.com/user/status/123'; route.pathname = '/user/status/123'; feed.setAttribute('aria-hidden', 'true');
  window.dispatchEvent(new PopStateEvent('popstate')); await settle();
  expect(feed.querySelector('[data-ft-owned="translation"]')).toBe(box); expect(translate.mock.calls[0]?.[3]?.aborted).toBe(false);
  complete?.('保留译文'); await settle();
  expect(box?.textContent).toContain('保留译文');
  route.href = 'https://x.com/home'; route.pathname = '/home'; feed.removeAttribute('aria-hidden'); window.dispatchEvent(new PopStateEvent('popstate')); await settle();
  expect(feed.querySelector('[data-ft-owned="translation"]')).toBe(box); expect(translate).toHaveBeenCalledOnce();
});
it('reattaches a completed X feed subtree without removing its translated nodes', async () => {
  const route = { hostname: 'x.com', href: 'https://x.com/home', pathname: '/home' }; vi.stubGlobal('location', route);
  document.body.innerHTML = '<article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a><div data-testid="tweetText">Original paragraph</div></article>';
  const translate = vi.spyOn(service, 'section').mockResolvedValue('保留译文'); runtime = new RedditRuntime({ ...service.settings }, service);
  const article = document.querySelector('article'); const root = document.querySelector('[data-testid="tweetText"]'); if (!article || !root) throw new Error('Missing tweet');
  Observer.instances[0]?.emit(root); await settle(); const boxes = [...article.querySelectorAll('[data-ft-owned="translation"]')]; expect(boxes.length).toBeGreaterThan(0);
  article.remove(); route.href = 'https://x.com/user/status/123'; window.dispatchEvent(new PopStateEvent('popstate')); await settle();
  expect([...article.querySelectorAll('[data-ft-owned="translation"]')]).toEqual(boxes);
  document.body.append(article); route.href = 'https://x.com/home'; window.dispatchEvent(new PopStateEvent('popstate')); await settle();
  expect([...article.querySelectorAll('[data-ft-owned="translation"]')]).toEqual(boxes); expect(translate).toHaveBeenCalledOnce();
});

it.each(['/home', '/user/status/111'])('keeps partial translations mounted while returning to %s before the background is unhidden', async pathname => {
  const route = { hostname: 'x.com', href: `https://x.com${pathname}`, pathname }; vi.stubGlobal('location', route);
  document.body.innerHTML = '<div id="page"><main><article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a><div data-testid="tweetText">First paragraph\n\nSecond paragraph</div></article></main></div>';
  const feed = document.querySelector('main'); const page = document.querySelector('#page'); const root = document.querySelector('[data-testid="tweetText"]');
  if (!feed || !page || !root) throw new Error('Missing feed');
  feed.setAttribute('data-ft-x-post-background', pathname);
  let complete: ((value: string) => void) | undefined;
  const translate = vi.spyOn(service, 'section').mockResolvedValueOnce('已完成译文').mockImplementationOnce((_text, _owner, _priority, _signal, progress) => {
    progress?.('正在生成的译文');
    return new Promise<string>(resolve => { complete = resolve; });
  });
  runtime = new RedditRuntime({ ...service.settings }, service); Observer.instances[0]?.emit(root); await settle();
  const boxes = [...feed.querySelectorAll('[data-ft-owned="translation"]')];
  route.pathname = '/user/status/123'; route.href = `https://x.com${route.pathname}`; page.setAttribute('aria-hidden', 'true');
  window.dispatchEvent(new PopStateEvent('popstate')); await settle();
  // Esc can commit the URL before X removes its modal scroll/visibility lock.
  route.pathname = pathname; route.href = `https://x.com${pathname}`;
  window.dispatchEvent(new PopStateEvent('popstate')); await settle();
  expect(translate.mock.calls[1]?.[3]?.aborted).toBe(false);
  expect(feed.textContent).toContain('正在生成的译文');
  page.removeAttribute('aria-hidden'); await settle();
  const returned = [...feed.querySelectorAll('[data-ft-owned="translation"]')];
  expect(returned).toHaveLength(boxes.length); returned.forEach((box, index) => expect(box).toBe(boxes[index]));
  complete?.('第二段已完成'); await settle();
  expect(feed.textContent).toContain('已完成译文'); expect(feed.textContent).toContain('第二段已完成');
  expect(translate).toHaveBeenCalledTimes(2);
});

it('accepts a background translation finishing immediately after Esc changes the URL back', async () => {
  const route = { hostname: 'x.com', href: 'https://x.com/home', pathname: '/home' }; vi.stubGlobal('location', route);
  document.body.innerHTML = '<main data-ft-x-post-background="/home"><article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a><div data-testid="tweetText">Original paragraph</div></article></main>';
  const feed = document.querySelector('main'); const root = document.querySelector('[data-testid="tweetText"]'); if (!feed || !root) throw new Error('Missing feed');
  let complete: ((value: string) => void) | undefined;
  const translate = vi.spyOn(service, 'section').mockImplementationOnce(() => new Promise<string>(resolve => { complete = resolve; })).mockResolvedValue('重复请求译文');
  runtime = new RedditRuntime({ ...service.settings }, service); Observer.instances[0]?.emit(root); await settle();
  const box = feed.querySelector('[data-ft-owned="translation"]'); expect(box).not.toBeNull();
  route.pathname = '/user/status/123'; route.href = `https://x.com${route.pathname}`; feed.setAttribute('aria-hidden', 'true');
  window.dispatchEvent(new PopStateEvent('popstate')); await settle();
  route.pathname = '/home'; route.href = 'https://x.com/home'; feed.removeAttribute('aria-hidden');
  window.dispatchEvent(new PopStateEvent('popstate')); complete?.('原请求完成');
  await settle();
  expect(feed.querySelector('[data-ft-owned="translation"]')).toBe(box);
  expect(box?.textContent).toContain('原请求完成'); expect(translate).toHaveBeenCalledOnce();
});

it('preserves X native Show more controls and translates content after expansion', async () => {
  document.body.innerHTML = '<article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a><div><div data-testid="tweetText">First paragraph</div><button data-testid="tweet-text-show-more-link">Show more</button></div></article>';
  const source = document.querySelector<HTMLElement>('[data-testid="tweetText"]');
  const button = document.querySelector<HTMLButtonElement>('[data-testid="tweet-text-show-more-link"]');
  if (!source || !button) throw new Error('Missing native tweet');
  button.addEventListener('click', () => { source.textContent = 'First paragraph. More original text.'; });
  const translate = vi.spyOn(service, 'section').mockResolvedValue('译文');
  runtime = new RedditRuntime({ ...service.settings }, service);
  Observer.instances[0]?.emit(source); await settle();
  expect(button.isConnected).toBe(true);
  expect(document.querySelector('[data-ft-long-post]')).toBeNull();
  button.click(); await settle();
  Observer.instances[0]?.emit(source); await settle();
  expect(source.textContent).toContain('More original text.');
  expect(translate.mock.calls.some(([text]) => String(text).includes('More original text.'))).toBe(true);
  expect(document.querySelector('[data-ft-long-source]')).toBeNull();
});
it('translates dynamically identified Article title and blocks inline without changing source media', async () => {
  document.body.innerHTML = `<main><h1 id="article-title">Memory guide</h1>
    <div id="article-body"><div data-block="true">First paragraph</div><h2>Introduction</h2>
    <ul><li>Use shared memory</li></ul><img src="cover.png"></div></main>`;
  const translate = vi.spyOn(service, 'section').mockResolvedValue('中文译文');
  runtime = new RedditRuntime({ ...service.settings, translationOnly: false }, service);
  const title = document.querySelector<HTMLElement>('#article-title');
  const body = document.querySelector<HTMLElement>('#article-body');
  if (!title || !body) throw new Error('Missing Article');
  const media = body.querySelector('img');
  title.dataset.testid = 'twitter-article-title'; body.dataset.testid = 'longformRichTextComponent';
  await settle();
  Observer.instances[0]?.emit(title);
  for (const block of body.querySelectorAll('[data-block],h2,li')) Observer.instances[0]?.emit(block);
  await settle();
  expect(translate.mock.calls.map(call => call[0])).toEqual(['Memory guide', 'First paragraph', 'Introduction', 'Use shared memory']);
  expect(title.nextElementSibling?.textContent).toContain('中文译文');
  expect(body.querySelectorAll('[data-ft-owned="translation"]')).toHaveLength(3);
  expect(body.querySelector('img')).toBe(media);
  await settle(); expect(translate).toHaveBeenCalledTimes(4);
  runtime.destroy();
  expect(body.querySelector('[data-ft-owned]')).toBeNull();
  expect(body.textContent).toContain('First paragraph'); expect(body.querySelector('img')).toBe(media);
});

it('preserves an in-flight Article translation during native SPA navigation without duplicate requests', async () => {
  const route = { hostname: 'x.com', href: 'https://x.com/user/status/123', pathname: '/user/status/123' };
  vi.stubGlobal('location', route);
  document.body.innerHTML = '<h1 data-testid="twitter-article-title">Memory guide</h1>';
  let finish: ((value: string) => void) | undefined;
  const translate = vi.spyOn(service, 'section').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue('记忆指南');
  runtime = new RedditRuntime({ ...service.settings }, service);
  const title = document.querySelector('h1'); if (!title) throw new Error('Missing title');
  Observer.instances[0]?.emit(title); await settle();
  route.href = 'https://x.com/user/article/123'; route.pathname = '/user/article/123';
  window.dispatchEvent(new PopStateEvent('popstate'));
  finish?.('记忆指南'); await Promise.resolve(); await Promise.resolve();
  await settle();
  expect(document.querySelector('[data-ft-owned="translation"]')?.textContent).toContain('记忆指南');
  expect(document.querySelector('.hnr-translation-placeholder')).toBeNull();
  expect(translate).toHaveBeenCalledOnce();
});

it('keeps a 231-block Article offscreen content out of the translation queue', async () => {
  document.body.innerHTML = '<div data-testid="twitterArticleRichTextView"><div data-testid="longformRichTextComponent" contenteditable="false">'
    + Array.from({ length: 231 }, (_, i) => `<div data-block="true"><div class="public-DraftStyleDefault-block">Article paragraph ${i}</div></div>`).join('') + '</div></div>';
  const translate = vi.spyOn(service, 'section').mockResolvedValue('段落译文');
  runtime = new RedditRuntime({ ...service.settings }, service);
  expect(Observer.instances[0]?.targets.size).toBe(231);
  expect(translate).not.toHaveBeenCalled();
  const blocks = document.querySelectorAll('[data-block="true"]');
  const first = blocks[0]; const last = blocks[230]; if (!first || !last) throw new Error('Missing blocks');
  Observer.instances[0]?.emit(first); await settle();
  expect(translate).toHaveBeenCalledTimes(1);
  expect(translate.mock.calls[0]?.[0]).toBe('Article paragraph 0');
  expect(first.nextElementSibling?.textContent).toContain('段落译文');
  expect(document.querySelectorAll('[data-ft-owned="translation"]')).toHaveLength(1);
  Observer.instances[0]?.emit(last); await settle();
  expect(translate).toHaveBeenCalledTimes(2);
  expect(translate.mock.calls[1]?.[0]).toBe('Article paragraph 230');
});

it('reuses persisted Article paragraphs across normal, expanded and restored views', async () => {
  const stored = new Map<string, unknown>();
  vi.stubGlobal('GM_getValue', (key: string, fallback: unknown) => stored.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', (key: string, value: unknown) => { stored.set(key, value); });
  const route = { hostname: 'x.com', href: 'https://x.com/user/status/123', pathname: '/user/status/123' };
  vi.stubGlobal('location', route);
  const article = '<article data-testid="twitterArticleReadView"><h1 data-testid="twitter-article-title">Memory guide</h1><div data-testid="longformRichTextComponent"><div data-block="true">Shared paragraph</div></div></article>';
  document.body.innerHTML = '<article data-testid="tweet"><a href="/user/status/123"><time>Now</time></a>' + article + '</article>';
  const translate = vi.spyOn(service, 'section').mockResolvedValue('缓存译文');
  runtime = new RedditRuntime({ ...service.settings }, service);
  for (const node of document.querySelectorAll('h1,[data-block]')) Observer.instances[0]?.emit(node);
  await settle(); expect(translate).toHaveBeenCalledTimes(2);
  runtime.destroy(); Observer.instances = [];
  for (const path of ['/user/article/123', '/user/status/123']) {
    route.pathname = path; route.href = `https://x.com${path}`;
    document.body.innerHTML = article;
    service = new TranslationService({ ...DEFAULTS }, new TranslationCache());
    const request = vi.spyOn(service, 'section').mockResolvedValue('不应重复请求');
    runtime = new RedditRuntime(service.settings, service);
    for (const node of document.querySelectorAll('h1,[data-block]')) Observer.instances[0]?.emit(node);
    await settle();
    expect([...document.querySelectorAll('[data-ft-owned="translation"]')].map(node => node.textContent)).toEqual(['缓存译文', '缓存译文']);
    expect(document.querySelector('.hnr-translation-placeholder')).toBeNull();
    expect(request).not.toHaveBeenCalled();
    runtime.destroy(); Observer.instances = [];
  }
  route.pathname = '/user/article/456'; route.href = `https://x.com${route.pathname}`;
  document.body.innerHTML = article;
  service = new TranslationService({ ...DEFAULTS }, new TranslationCache());
  const otherArticle = vi.spyOn(service, 'section').mockResolvedValue('另一篇文章');
  runtime = new RedditRuntime(service.settings, service);
  for (const node of document.querySelectorAll('h1,[data-block]')) Observer.instances[0]?.emit(node);
  await settle();
  expect(otherArticle).toHaveBeenCalledTimes(2);
});
