import { mountFontStyles } from './fonts';
import { loadSettings, saveSettings, loadTranslationOnly, saveTranslationOnly } from './settings';
import { RedditRuntime } from './runtime';
import { TranslationCache, TranslationService } from './translation/service';
import { mountControls } from './ui';
import { RedditMediaResize } from './reddit-media-resize';
import { RedditAds } from './reddit-ads';

function boot(): void {
  if (document.querySelector('[data-ft-owned="style"]')) return;
  const style = document.createElement('style'); style.dataset.ftOwned = 'style'; style.textContent = __FT_CSS__; document.head.append(style);
  let settings = loadSettings();
  const fonts = mountFontStyles(settings.fonts);
  const redditMedia = new RedditMediaResize();
  const redditAds = new RedditAds();
  const cache = new TranslationCache();
  let runtime: RedditRuntime | undefined;
  const restart = (): void => {
    runtime?.destroy(); runtime = undefined;
    if (settings.enabled) runtime = new RedditRuntime(settings, new TranslationService(settings, cache), () => {
      const next = loadSettings();
      if (next.profileId === settings.profileId && next.profileRevision === settings.profileRevision) return false;
      settings = next;
      queueMicrotask(restart);
      return true;
    });
  };
  const reloadProfile = (): void => {
    const next = loadSettings();
    settings = next;
    fonts.update(next.fonts);
    restart();
  };
  const removeControls = mountControls(() => ({ ...settings, translationOnly: loadTranslationOnly() }), next => {
    const styleOnly = JSON.stringify({ ...settings, fonts: next.fonts, translationTheme: next.translationTheme }) === JSON.stringify(next);
    settings = next; saveTranslationOnly(next.translationOnly); saveSettings(next);
    fonts.update(next.fonts);
    if (styleOnly && runtime) runtime.setTranslationTheme(next.translationTheme); else restart();
  }, () => cache.clear(), reloadProfile);
  restart();
  window.addEventListener('pagehide', event => {
    runtime?.destroy(); runtime = undefined; cache.flush();
    if (!event.persisted) { redditMedia.destroy(); redditAds.destroy(); removeControls(); fonts.destroy(); style.remove(); }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) restart(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
