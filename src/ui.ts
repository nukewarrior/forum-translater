import { createLocalFontQuery, mountFontSettings } from './font-settings';
import { isXSite, TRANSLATION_THEMES, type TranslationTheme } from './settings';
import { mountProfileMenu, mountProfileSection } from './profile-ui';
import { readTranslationMetrics } from './translation/metrics';
import { isRedditHomeFeedRoute, OWNED } from './reddit';
import { normalizeSettings, type Settings } from './settings';
export function mountControls(read: () => Settings, save: (settings: Settings) => void, clearCache: () => void, onProfileChanged?: () => void): () => void {
  const host = document.createElement('div'); host.dataset.ftOwned = 'controls'; host.hidden = true; document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  // Layout and palette adapted from the WSL Image Insight settings panel.
  style.textContent = `
    :host{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;color:#172033;color-scheme:light}
    *{box-sizing:border-box}[hidden]{display:none!important}
    dialog{width:min(1120px,calc(100vw - 48px));height:min(90dvh,900px);max-width:none;max-height:none;padding:0;border:1px solid #ddd8cf;border-radius:22px;background:#f7f5ef;color:#172033;box-shadow:0 28px 80px #0c111e57}
    dialog::backdrop{background:#17203394;backdrop-filter:blur(3px)}
    button,input,select,textarea{font:inherit}button{cursor:pointer;color:inherit;border:1px solid #cbc7bd;border-radius:9px;background:white;padding:9px 14px}
    button:hover{background:#eeeffb}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #4758d6;outline-offset:2px}
    .panel{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;margin:0}
    header{display:flex;align-items:center;gap:12px;min-height:72px;padding:12px 24px;background:#ffffffb8;border-bottom:1px solid #ddd8cf}
    .brand{background:#172033;color:white;border-radius:8px;width:32px;height:32px;display:grid;place-items:center;font-weight:700}
    h1{font-size:16px;margin:0}header small{color:#707788;font-size:11px}header button{margin-left:auto;border:0;background:transparent;font-size:22px;padding:2px 10px}
    .layout{display:grid;grid-template-columns:176px minmax(0,1fr);gap:22px;padding:28px 32px;overflow:auto;scrollbar-gutter:stable;align-items:start}
    nav{position:sticky;top:0;display:grid;border-left:1px solid #ddd8cf}
    nav button{text-align:left;min-height:62px;border:0;border-radius:0;border-left:2px solid transparent;margin-left:-1px;background:transparent;padding:10px 14px}
    nav strong,nav small{display:block}nav strong{font-size:13px}nav small{font-size:11px;color:#707788;margin-top:3px}
    nav button[aria-selected=true]{border-left-color:#4758d6;background:#eef0ff;color:#4758d6}
    .content{min-width:0}.section{padding:22px;border:1px solid #ddd8cf;border-radius:14px;background:#fffefa}
    h2{font-size:15px;margin:0 0 18px}label{display:block;font-size:12px;font-weight:600;color:#424b5f;margin:16px 0}
    label:has(input[type=checkbox]){display:flex;align-items:center;gap:10px;padding:12px;border:1px solid #e3dfd6;border-radius:9px;font-size:13px}
    input:not([type=checkbox]),select,textarea{display:block;width:100%;min-height:40px;padding:8px 10px;margin-top:6px;border:1px solid #cbc7bd;border-radius:9px;background:white;color:#172033;font-size:13px}
    input[type=checkbox]{width:17px;height:17px;accent-color:#4758d6;flex-shrink:0}textarea{resize:vertical;min-height:120px;line-height:1.6}
    fieldset{border:0;padding:0;margin:0;min-width:0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    p{font-size:12px;color:#707788;line-height:1.8}footer{padding:14px 24px;border-top:1px solid #ddd8cf;background:#ffffffb8;display:flex;align-items:center;justify-content:flex-end;gap:16px}
    [role=status]{margin:0;margin-right:auto;color:#4758d6}.actions{display:flex;gap:10px}.primary{background:#4758d6;color:white;border-color:#4758d6}.primary:hover{background:#3948b8}
    .font-hint{margin:0 0 10px;font-size:12px}.font-catalog{display:flex;align-items:center;gap:12px;min-height:30px;margin-bottom:20px}.font-catalog [role=status]{font-size:12px;font-weight:400;color:#707788}.font-catalog button{flex:none;font-size:12px;padding:5px 10px}
    .font-scope-tabs{display:flex;gap:4px;padding:4px;width:fit-content;background:#eeece6;border-radius:9px;margin:0 0 16px}.font-scope-tabs button{min-width:84px;padding:7px 20px;border:0;border-radius:6px;background:transparent;font-size:13px;color:#707788}.font-scope-tabs button[aria-selected=true]{background:#fff;color:#172033;box-shadow:0 1px 4px #17203312;font-weight:600}.font-group{border:1px solid #e3dfd6;border-radius:12px;padding:18px;background:#fff}.font-group label{font-size:12px;font-weight:500;margin:0 0 14px}.font-group input{font-weight:400}.font-group input[type=search]{margin:0 0 10px;font-size:12px}
    .font-preview{height:104px;display:flex;align-items:safe center;padding:16px;margin:4px 0 16px;background:#f7f6f2;border:1px solid #eeebe5;border-radius:8px;overflow:auto;overflow-wrap:anywhere;line-height:1.6;color:#172033;font-weight:400}
    .font-options{height:236px;overflow:auto;scrollbar-gutter:stable;margin:0 0 14px;display:grid;grid-auto-rows:64px;align-content:start;gap:5px}.font-option{text-align:left;display:flex;flex-direction:column;justify-content:center;gap:3px;padding:8px 11px;border:1px solid transparent;border-radius:7px;background:#faf9f6;min-width:0;line-height:1.4}.font-name{font-size:12px;font-weight:500;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.font-option:hover{background:#f0eee8}.font-option[aria-pressed=true]{border-color:#c4caf2;background:#eef0ff;box-shadow:inset 3px 0 #5966c7}.font-sample{font-size:15px;font-weight:400;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;color:#424b5f}.font-reset{padding:5px 0;border:0;background:transparent;font-size:12px;color:#707788}.font-reset:hover{background:transparent;color:#4758d6}

    @media(max-width:680px){dialog{width:calc(100vw - 20px);height:94dvh;border-radius:16px}.layout{display:block;padding:16px}nav{position:static;display:flex;overflow:auto;border-left:0;border-bottom:1px solid #ddd8cf;margin-bottom:16px}nav button{flex:1;white-space:nowrap;min-height:44px;border-left:0;border-bottom:2px solid transparent;padding:8px}nav button[aria-selected=true]{border-bottom-color:#4758d6}nav small{display:none}.section{padding:16px}.pair{grid-template-columns:1fr;gap:0}footer{padding:12px 16px;flex-wrap:wrap}header{padding:12px 16px}}
  `;
  shadow.append(style);
  const queryFonts = createLocalFontQuery(document);
  let fontControls: ReturnType<typeof mountFontSettings> | undefined;
  let disposeProfiles: (() => void) | undefined;
  let previousFocus: HTMLElement | null = null;
  const dialog = document.createElement('dialog'); dialog.setAttribute('aria-label', `${isXSite() ? 'X' : 'Reddit'} 翻译设置`); shadow.append(dialog);
  const panel = document.createElement('form'); panel.className = 'panel'; panel.hidden = true; panel.setAttribute('aria-label', `${isXSite() ? 'X' : 'Reddit'} 翻译设置`); dialog.append(panel); panel.noValidate = true;
  function render(): void {
    panel.replaceChildren(); const current = read();
    const header = document.createElement('header');
    const brand = document.createElement('span'); brand.className = 'brand'; brand.textContent = '译';
    const title = document.createElement('div'); const heading = document.createElement('h1'); heading.textContent = 'forum-translator';
    const subtitle = document.createElement('small'); subtitle.textContent = '翻译设置'; title.append(heading, subtitle);
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', '关闭设置'); dismiss.onclick = () => setOpen(false);
    header.append(brand, title, dismiss); panel.append(header);
    const layout = document.createElement('div'); layout.className = 'layout'; panel.append(layout);
    const nav = document.createElement('nav'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', '设置分类');
    const content = document.createElement('div'); content.className = 'content'; layout.append(nav, content);
    const sections = new Map<string, HTMLElement>(); const tabs = new Map<string, HTMLButtonElement>();
    const activate = (id: string): void => {
      if (id === 'fonts') fontControls?.activate();
      for (const [key, section] of sections) section.hidden = key !== id;
      for (const [key, tab] of tabs) { tab.setAttribute('aria-selected', String(key === id)); tab.tabIndex = key === id ? 0 : -1; }
    };
    for (const [id, name, description] of [['api', '翻译配置', 'Profile 与 AI 接口'], ['scope', '翻译范围', '内容与预加载'], ['fonts', '字体', '标题、正文与预览'], ['cache', '缓存与说明', '本地数据与隐私']] as const) {
      const tab = document.createElement('button'); tab.type = 'button'; tab.id = `ft-tab-${id}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `ft-panel-${id}`);
      const strong = document.createElement('strong'); strong.textContent = name; const small = document.createElement('small'); small.textContent = description; tab.append(strong, small);
      tab.onclick = () => activate(id); nav.append(tab); tabs.set(id, tab);
      const section = document.createElement('section'); section.className = 'section'; section.id = `ft-panel-${id}`; section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', tab.id);
      const sectionTitle = document.createElement('h2'); sectionTitle.textContent = name; section.append(sectionTitle); content.append(section); sections.set(id, section);
    }
    nav.onkeydown = event => {
      const all = [...tabs.entries()]; const index = all.findIndex(([, tab]) => tab === shadow.activeElement);
      if (index < 0 || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + all.length) % all.length;
      const entry = all[next]; if (entry) { activate(entry[0]); entry[1].focus(); }
    };
    const api = sections.get('api'); const scope = sections.get('scope'); const cache = sections.get('cache');
    if (!api || !scope || !cache) throw new Error('Missing settings sections');
    activate('api');
    const fontSection = sections.get('fonts');
    if (fontSection) fontControls = mountFontSettings(fontSection, current.fonts, queryFonts);
    let target = scope;
    const fields = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
    function input(name: string, text: string, type: string, value: string | boolean): HTMLInputElement {
      const label = document.createElement('label'); const field = document.createElement('input'); field.name = name; field.type = type;
      if (typeof value === 'boolean') field.checked = value; else field.value = value;
      if (type === 'number') { field.min = '0'; field.max = '5000'; field.step = '100'; }
      if (type === 'password') field.autocomplete = 'off';
      if (type === 'checkbox') label.append(field, ` ${text}`); else label.append(text, field);
      target.append(label); fields.set(name, field); return field;
    }
    input('translationOnly', `只显示译文（${isXSite() ? 'X' : 'Reddit'} 全站生效）`, 'checkbox', current.translationOnly);
    const themeLabel = document.createElement('label'); themeLabel.textContent = '译文样式';
    const theme = document.createElement('select'); theme.name = 'translationTheme';
    for (const [value, name] of Object.entries(TRANSLATION_THEMES)) { const option = document.createElement('option'); option.value = value; option.textContent = name; theme.append(option); }
    theme.value = current.translationTheme; themeLabel.append(theme); scope.append(themeLabel);
    input('enabled', '开启本页及后续页面自动翻译', 'checkbox', current.enabled);
    for (const [key, label] of [['title', isXSite() ? '帖子标题' : '帖子详情及搜索结果标题'], ['body', '帖子正文'], ['comment', '评论']] as const) {
      const field = input(key, isXSite() && key === 'body' ? '推文、回复与引用推文' : label, 'checkbox', current[key]);
      if (isXSite() && key !== 'body' && field.parentElement) field.parentElement.hidden = true;
    }
    const feedTitle = input('redditFeedTitle', '首页及板块列表的帖子标题', 'checkbox', current.redditFeedTitle);
    if (isXSite() && feedTitle.parentElement) feedTitle.parentElement.hidden = true;
    input('before', '向上预加载（像素）', 'number', String(current.before));
    input('after', '向下预加载（像素）', 'number', String(current.after));
    disposeProfiles = mountProfileSection(api, () => { onProfileChanged?.(); profileMenu.refresh(); });
    const notice = document.createElement('p'); notice.textContent = '译文显示在原文下方，只翻译网站已加载且靠近视口的内容。AI 模型及请求数据发送至所选服务。'; cache.append(notice);
    const footer = document.createElement('footer'); panel.append(footer);
    const status = document.createElement('p'); status.setAttribute('role', 'status'); footer.append(status);
    const actions = document.createElement('div'); actions.className = 'actions'; footer.append(actions);
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = '保存并应用'; submit.className = 'primary'; actions.append(submit);
    const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = '清除译文缓存'; clear.onclick = () => { clearCache(); status.textContent = '缓存已清除，已显示的译文保留。'; }; cache.append(clear);
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭'; close.onclick = () => setOpen(false); actions.append(close);
    panel.onsubmit = event => {
      event.preventDefault(); const next = { ...current };
      if (fontControls && !fontControls.valid()) { activate('fonts'); fontSection?.querySelector<HTMLInputElement>('input:invalid')?.reportValidity(); return; }
      next.fonts = fontControls?.read() ?? current.fonts;
      next.translationTheme = theme.value as TranslationTheme;
      for (const name of ['enabled', 'title', 'redditFeedTitle', 'body', 'comment', 'translationOnly'] as const) next[name] = (fields.get(name) as HTMLInputElement).checked;
      for (const name of ['before', 'after'] as const) next[name] = Number(fields.get(name)?.value);
      for (const field of fields.values()) {
        if (!field.matches(':disabled') && !field.checkValidity()) { activate('scope'); field.reportValidity(); return; }
      }
      save(normalizeSettings(next)); setOpen(false);
    };
  }
  function setOpen(open: boolean): void {
    disposeProfiles?.(); disposeProfiles = undefined; fontControls?.destroy(); fontControls = undefined;
    if (open) {
      if (panel.hidden) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      render();
    }
    panel.hidden = !open; host.hidden = !open;
    if (open) { if (!dialog.open) dialog.showModal(); panel.querySelector<HTMLButtonElement>('header button')?.focus(); } else { dialog.close(); panel.replaceChildren(); panel.onsubmit = null; profileMenu.refresh(); if (previousFocus?.isConnected) previousFocus.focus(); }
    homeShortcut?.refresh();
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); setOpen(false); });
  shadow.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape' && !panel.hidden) setOpen(false); });
  const profileMenu = mountProfileMenu(() => { onProfileChanged?.(); if (!panel.hidden) render(); });
  // On Reddit's home feed (including sort routes), show a shortcut to the settings dialog.
  const homeShortcut = !isXSite() ? mountRedditHomeSettingsShortcut(
    () => setOpen(true), () => dialog.open,
  ) : undefined;
  const menu = GM_registerMenuCommand(`${isXSite() ? 'X' : 'Reddit'} 翻译设置`, () => setOpen(true));
  const metricsMenu = GM_registerMenuCommand('翻译性能统计（当前页面）', () => { alert(JSON.stringify(readTranslationMetrics(), null, 2)); });
  // Guard helps hot-reload owners distinguish this surface from host DOM.
  if (!host.matches(OWNED)) throw new Error('Missing UI ownership');
  return () => { fontControls?.destroy(); disposeProfiles?.(); profileMenu.destroy(); if (dialog.open) dialog.close(); GM_unregisterMenuCommand(menu); GM_unregisterMenuCommand(metricsMenu); homeShortcut?.destroy(); host.remove(); };
}

/** Reddit home-feed settings shortcut, including sort routes. */
function mountRedditHomeSettingsShortcut(
  openSettings: () => void,
  isDialogOpen: () => boolean,
): { refresh(): void; destroy(): void } {
  const host = document.createElement('div');
  host.dataset.ftOwned = 'reddit-home-settings';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = [
    ':host{all:initial}',
    'button{position:fixed;right:20px;bottom:22px;z-index:2147483000;display:flex;align-items:center;gap:7px;',
    'padding:10px 14px;border:1px solid #d9deea;border-radius:999px;background:#fff;color:#293751;',
    'box-shadow:0 5px 20px #182b4930;font:600 12px/1.35 system-ui,-apple-system,sans-serif;cursor:pointer}',
    'button:hover{background:#f0f2ff;border-color:#8e98d9}',
    'button:focus-visible{outline:2px solid #4758d6;outline-offset:3px}',
    'button[hidden]{display:none!important}',
    '@media(max-width:680px){button{right:14px;bottom:16px;padding:9px 12px}}',
  ].join('');
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', '打开 Reddit 翻译设置');
  button.title = '论坛译读 · 翻译设置';
  button.textContent = '译 · 翻译设置';
  button.onclick = openSettings;
  shadow.append(style, button);
  document.body.append(host);

  let previousRoute = '';
  const update = (): void => {
    previousRoute = location.href;
    button.hidden = !isRedditHomeFeedRoute() || isDialogOpen();
  };
  // Reddit may use history.pushState without firing popstate. This observer
  // only detects URL changes; it does not scan or mutate feed content.
  const observer = new MutationObserver(() => {
    if (location.href !== previousRoute) update();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', update);
  window.addEventListener('hashchange', update);
  window.addEventListener('pageshow', update);
  update();
  return {
    refresh: update,
    destroy: () => {
      observer.disconnect();
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
      window.removeEventListener('pageshow', update);
      host.remove();
    },
  };
}
