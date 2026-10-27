// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentIdentity, discover, feedTitleLink, isRedditFeedRoute, sourceSnapshot } from '../src/reddit';
import { translationSectionPlans } from '../src/translation/translation-text';
import { normalizeSettings } from '../src/settings';

afterEach(() => vi.unstubAllGlobals());

describe('Reddit content owners', () => {
  it('recognizes only home and subreddit feed routes for the new switch', () => {
    expect(isRedditFeedRoute('/', 'www.reddit.com')).toBe(true);
    expect(isRedditFeedRoute('/r/DeepSeek/', 'reddit.com')).toBe(true);
    expect(isRedditFeedRoute('/r/DeepSeek/new/', 'www.reddit.com')).toBe(true);
    expect(isRedditFeedRoute('/r/all/top/', 'www.reddit.com')).toBe(true);
    expect(isRedditFeedRoute('/r/DeepSeek/comments/abc/post/', 'www.reddit.com')).toBe(false);
    expect(isRedditFeedRoute('/r/DeepSeek/search/', 'www.reddit.com')).toBe(false);
    expect(isRedditFeedRoute('/', 'x.com')).toBe(false);
  });
  it('finds card and compact titles without unrelated headings or unsafe translated links', () => {
    document.body.innerHTML = `<h3>Community navigation</h3>
      <shreddit-post post-id="t3_a"><a id="post-title-t3_a" href="/r/test/comments/a/hello/"><h2>Card title</h2></a></shreddit-post>
      <shreddit-post post-id="t3_b"><a slot="title" href="/r/test/comments/b/hello/">Compact title</a></shreddit-post>
      <shreddit-post post-id="t3_c"><a id="post-title-t3_c" href="https://example.com/r/test/comments/c/">Untrusted title link</a></shreddit-post>`;
    const titles = discover(document).filter(item => item.kind === 'title');
    expect(titles.map(item => item.element.textContent).sort()).toEqual(['Card title', 'Compact title', 'Untrusted title link']);
    const card = titles.find(item => item.element.textContent === 'Card title');
    const unsafe = titles.find(item => item.element.textContent === 'Untrusted title link');
    expect(card && feedTitleLink(card.element)?.getAttribute('href')).toBe('/r/test/comments/a/hello/');
    expect(unsafe && feedTitleLink(unsafe.element)).toBeNull();
  });
  it('normalizes Reddit post IDs across list and detail markup', () => {
    document.body.innerHTML = '<shreddit-post id="virtual-row" post-id="ABC123"><a id="post-title-t3_abc123" href="/r/test/comments/abc123/hello/"><h2>Same English title</h2></a></shreddit-post>';
    expect(contentIdentity(document.querySelector<HTMLElement>('a')!)).toBe('t3_abc123');
    document.body.innerHTML = '<shreddit-post thingid="t3_abc123"><a slot="title"><h1>Same English title</h1></a></shreddit-post>';
    expect(contentIdentity(document.querySelector<HTMLElement>('[slot="title"]')!)).toBe('t3_abc123');
  });
  it('uses post title links or permalinks instead of temporary wrapper IDs', () => {
    vi.stubGlobal('location', { hostname: 'www.reddit.com', pathname: '/', href: 'https://www.reddit.com/' });
    document.body.innerHTML = '<shreddit-post id="virtual-card-42"><a id="post-title-t3_abc123" href="/r/test/comments/ABC123/hello/">Same English title</a></shreddit-post>';
    expect(contentIdentity(document.querySelector<HTMLElement>('a')!)).toBe('t3_abc123');
    document.body.innerHTML = '<shreddit-post id="temporary" permalink="/r/test/comments/abc123/hello/"><a slot="title">Same English title</a></shreddit-post>';
    expect(contentIdentity(document.querySelector<HTMLElement>('a')!)).toBe('t3_abc123');
    document.body.innerHTML = '<shreddit-post id="temporary"><a slot="title" href="https://example.com/r/test/comments/abc123/">External link</a></shreddit-post>';
    expect(contentIdentity(document.querySelector<HTMLElement>('a')!)).toBe('');
  });
  it('does not confuse comments or other posts with the same title', () => {
    document.body.innerHTML = '<shreddit-comment thingid="t1_AbC"><div slot="comment">Comment</div></shreddit-comment><shreddit-post post-id="zzz123"><a slot="title">Same English title</a></shreddit-post>';
    expect(contentIdentity(document.querySelector<HTMLElement>('[slot="comment"]')!)).toBe('t1_abc');
    expect(contentIdentity(document.querySelector<HTMLElement>('[slot="title"]')!)).toBe('t3_zzz123');
  });
  it('excludes injected translations from link labels in source snapshots', () => {
    const source = document.createElement('div'); source.innerHTML = '<a href="https://example.com">example.com</a>';
    const before = sourceSnapshot(source).innerHTML;
    const translated = document.createElement('div'); translated.dataset.ftOwned = 'translation'; translated.textContent = '译文';
    source.querySelector('a')?.append(translated);
    expect(sourceSnapshot(source).innerHTML).toBe(before);
  });
  it('preserves visually displayed link spans, ellipsis and destination without copying hidden semantics', () => {
    const source = document.createElement('div'); source.innerHTML = '<a href="https://github.com/user/project"><span aria-hidden="true">github.com/</span><span>user/…</span></a>';
    const anchor = sourceSnapshot(source).querySelector('a');
    expect(anchor?.textContent).toBe('github.com/user/…'); expect(anchor?.getAttribute('href')).toBe('https://github.com/user/project');
    expect(anchor?.getAttribute('title')).toBe('https://github.com/user/project');
  });
  it('finds modern title, body and separate nested comments without credits or generated content', () => {
    document.body.innerHTML = `<shreddit-post><a slot="title"><h1>Post title</h1></a><div slot="text-body"><div id="t3_x-post-rtjson-content"><p>Post body</p></div></div><span slot="credit-bar">user</span><div data-ft-owned slot="title">译文</div></shreddit-post><shreddit-comment><div slot="comment"><p>Parent text</p></div><shreddit-comment><div slot="comment"><p>Child text</p></div></shreddit-comment></shreddit-comment>`;
    expect(discover(document).map(item => [item.kind, item.element.textContent])).toEqual([
      ['title', 'Post title'], ['body', 'Post body'], ['comment', 'Parent text'], ['comment', 'Child text'],
    ]);
  });
  it('supports old Reddit without collecting nested replies twice', () => {
    document.body.innerHTML = `<div class="thing link"><div class="entry"><a class="title">Title</a><div class="usertext-body"><div class="md">Body</div></div></div></div><div class="thing comment"><div class="entry"><div class="usertext-body"><div class="md">Comment</div></div></div></div>`;
    expect(discover(document).map(item => item.kind)).toEqual(['title', 'body', 'comment']);
  });
  it('finds current Reddit search result titles and previews without the full-card accessibility link', () => {
    vi.stubGlobal('location', { hostname: 'www.reddit.com', pathname: '/search/', href: 'https://www.reddit.com/search/' });
    document.body.innerHTML = `<div data-testid="search-post-with-content-preview">
      <h2><a data-testid="post-title" href="/r/test/comments/abc/search-result/"><span>Search result title</span></a></h2>
      <div data-testid="sdui-post-unit">
        <search-telemetry-tracker><a data-testid="post-title-text" href="/r/test/comments/abc/search-result/">Search result title</a></search-telemetry-tracker>
        <search-telemetry-tracker><a href="/r/test/comments/abc/search-result/">A sufficiently detailed search result preview.</a></search-telemetry-tracker>
      </div>
    </div>`;
    const candidates = discover(document);
    expect(candidates.map(item => [item.kind, item.element.textContent])).toEqual([
      ['title', 'Search result title'], ['body', 'A sufficiently detailed search result preview.'],
    ]);
    expect(candidates.map(item => contentIdentity(item.element))).toEqual(['t3_abc', 't3_abc']);
  });
  it('sanitizes copied structure and preserves original media and links', () => {
    const source = document.createElement('div');
    source.innerHTML = '<p id="x" onclick="bad()">Hello <strong>world</strong><a href="javascript:bad()">unsafe</a><a href="https://example.com">safe</a><code>npm run</code><img src="x"><button>vote</button><input value="secret"><div contenteditable="true">draft</div></p>';
    const before = source.innerHTML; const snapshot = sourceSnapshot(source);
    expect(snapshot.querySelector('a')?.getAttribute('href')).toBe('https://example.com/');
    expect(snapshot.querySelector('[id],[onclick],input,img,button,[contenteditable]')).toBeNull();
    expect(snapshot.textContent).not.toMatch(/vote|secret|draft/);
    expect(snapshot.querySelector('strong')?.textContent).toBe('world');
    expect(source.innerHTML).toBe(before);
  });
  it('rejects editor and ad owners and bounds settings', () => {
    document.body.innerHTML = '<shreddit-ad-post><shreddit-post><h1>Ad</h1></shreddit-post></shreddit-ad-post><div contenteditable="true"><shreddit-comment><p slot="comment">Draft</p></shreddit-comment></div>';
    expect(discover(document)).toEqual([]);
    expect(normalizeSettings({ before: -1, after: Infinity })).toMatchObject({ enabled: true, before: 0, after: 1200 });
  });
});

it('discovers X tweet, reply and quote text without usernames, controls or translated text', () => {
  document.body.innerHTML = '<nav>Explore</nav><article data-testid="tweet"><div data-testid="User-Name">Someone</div><div data-testid="tweetText"><span>Hello</span><br><a href="https://example.com">link</a></div><div role="link"><div data-testid="tweetText">Quoted post</div></div><button>Reply</button><div data-ft-owned="translation"><div data-testid="tweetText">旧译文</div></div></article><article data-testid="tweet"><div data-testid="tweetText">A reply</div></article><div data-testid="tweetText" contenteditable="true">Draft</div>';
  const candidates = discover(document);
  expect(candidates.map(item => [item.kind, item.element.textContent])).toEqual([['body', 'Hellolink'], ['body', 'Quoted post'], ['body', 'A reply']]);
  const first = candidates[0]; if (!first) throw new Error('Missing tweet');
  expect(sourceSnapshot(first.element).querySelector('a')?.getAttribute('href')).toBe('https://example.com/');
  expect(sourceSnapshot(first.element).querySelector('br')).not.toBeNull();
});

it('discovers Article titles and rich text once, including standalone posts but excluding editors', () => {
  document.body.innerHTML = `<main><div data-testid="twitterArticleReadView">
    <h1 data-testid="twitter-article-title">Article title</h1>
    <div data-testid="twitterArticleRichTextView"><div data-testid="longformRichTextComponent">
      <h2>Introduction</h2><div data-block="true"><div class="public-DraftStyleDefault-block">First paragraph</div></div>
      <div data-block="true">Second paragraph</div><ul><li>First item</li><li>Second item</li></ul>
      <pre><code>const answer = 42;</code></pre><img src="cover.png"><button>Share</button>
    </div></div></div><div data-testid="tweetText">Standalone reply</div>
    <div contenteditable="true"><div data-testid="longformRichTextComponent">Draft article</div></div>
    <div data-ft-owned="translation"><div data-testid="twitterArticleTitle">Old translation</div></div></main>`;
  const candidates = discover(document);
  expect(candidates.map(item => item.kind)).toEqual(['title', ...Array.from({ length: 6 }, () => 'body')]);
  expect(candidates.slice(1).map(item => item.element.textContent)).toEqual(['Introduction', 'First paragraph', 'Second paragraph', 'First item', 'Second item', 'Standalone reply']);
  const body = document.querySelector<HTMLElement>('[data-testid="twitterArticleRichTextView"]'); if (!body) throw new Error('Missing article');
  const origins = new Map<Node, HTMLElement>();
  const snapshot = sourceSnapshot(body, origins);
  expect(translationSectionPlans(snapshot).map(plan => plan.text)).toEqual([
    'Introduction', 'First paragraph', 'Second paragraph', 'First item', 'Second item',
  ]);
  expect(snapshot.querySelector('pre code')?.textContent).toBe('const answer = 42;');
  expect(snapshot.querySelector('button,img')).toBeNull();
  expect([...origins.values()].some(node => node.classList.contains('public-DraftStyleDefault-block'))).toBe(true);
  expect(discover(body)).toEqual(candidates.slice(1, 6));
});
