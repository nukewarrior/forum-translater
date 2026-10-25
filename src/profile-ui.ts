import { activeProfile, cloneProfile, listProfiles, makeProfile, removeProfile, selectProfile, upsertProfile, type TranslationProfile, type TranslationProvider } from './profile-store';
import { normalizeAiBaseUrl, validateAiProfile } from './settings';
import { requestJson } from './translation/provider';
import { translateAi } from './translation/ai';

const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const typeLabel = (provider: TranslationProvider): string => provider === 'ai' ? '自定义 AI' : provider === 'google' ? 'Google 翻译' : 'Microsoft 翻译';
const complete = (profile: TranslationProfile): boolean => profile.provider !== 'ai' || (!!profile.ai.baseUrl.trim() && !!profile.ai.model.trim());
const copy = (profile: TranslationProfile): TranslationProfile => ({ ...profile, ai: { ...profile.ai } });

export function mountProfileMenu(onActivated: () => void): { refresh(): void; destroy(): void } {
  const ids: number[] = [];
  const refresh = (): void => {
    for (const id of ids.splice(0)) GM_unregisterMenuCommand(id);
    const { activeId, profiles } = listProfiles();
    for (const profile of profiles) {
      ids.push(GM_registerMenuCommand((profile.id === activeId ? '✓ ' : '　') + profile.name, () => {
        try { selectProfile(profile.id); refresh(); onActivated(); }
        catch (error) { alert(error instanceof Error ? error.message : '切换失败'); }
      }));
    }
  };
  refresh();
  return { refresh, destroy: () => { for (const id of ids.splice(0)) GM_unregisterMenuCommand(id); } };
}

export function mountProfileSection(root: HTMLElement, onChanged: () => void): () => void {
  const style = document.createElement('style');
  style.textContent = `
    .ft-profiles{display:grid;grid-template-columns:minmax(150px,.8fr) minmax(220px,1.35fr);gap:13px;margin-top:14px}
    .ft-profiles .ft-panel{border:1px solid #e3e5ee;border-radius:11px;min-width:0;background:#fff;padding:13px}
    .ft-profiles .ft-row{width:100%;display:block;text-align:left;border:1px solid transparent;background:#fff;padding:11px;border-radius:8px;margin-bottom:5px;color:#202a40}
    .ft-profiles .ft-row[aria-selected=true]{background:#f0f2ff;border-color:#cdd2fc}
    .ft-profiles .ft-row span{display:block;color:#738099;font-size:11px;margin-top:3px}
    .ft-profiles .ft-actions{display:flex;flex-wrap:wrap;gap:7px;margin:13px 0}
    .ft-profiles button{padding:8px 11px;border:1px solid #dce1ec;border-radius:7px;background:#fff;color:#33425f;font-size:12px;cursor:pointer}
    .ft-profiles button:disabled{opacity:.45;cursor:not-allowed}
    .ft-profiles button.ft-primary{background:#505cd6;border-color:#505cd6;color:#fff}
    .ft-profiles label{display:block;color:#475166;font-size:12px;margin:12px 0}
    .ft-profiles input,.ft-profiles select,.ft-profiles textarea{display:block;width:100%;padding:8px 10px;margin-top:5px;border:1px solid #d6dce8;border-radius:7px;background:#fff;color:#222e44;min-width:0}
    .ft-profiles textarea{min-height:74px;resize:vertical}
    .ft-profiles .ft-inline{display:flex;gap:7px;align-items:center}
    .ft-profiles .ft-inline input{flex:1}
    .ft-profiles .ft-inline button{white-space:nowrap}
    .ft-profiles .ft-muted{color:#78849a;font-size:11px;margin:8px 0;line-height:1.5}
    .ft-profiles .ft-message{color:#4b57b0;font-size:12px;margin:8px 0}
    .ft-profiles details{margin:12px 0;border:1px solid #e2e6ef;border-radius:8px;padding:10px}
    .ft-profiles summary{cursor:pointer;font-weight:600}
    @media(max-width:760px){.ft-profiles{grid-template-columns:1fr}}
  `;
  root.append(style);
  const host = document.createElement('div');
  host.className = 'ft-profiles';
  root.append(host);
  let selectedId = listProfiles().activeId;
  let draft = copy(activeProfile());
  let dirty = false;
  let message = '';
  let models: string[] = [];
  let keyShown = false;
  let request: AbortController | undefined;
  let disposed = false;

  function setSelected(id: string): void {
    if (dirty && !confirm('放弃未保存的 Profile 修改？')) return;
    const profile = listProfiles().profiles.find(item => item.id === id);
    if (!profile) return;
    selectedId = id; draft = copy(profile); dirty = false; models = []; message = ''; render();
  }
  function render(): void {
    if (disposed) return;
    const state = listProfiles();
    const isNew = !state.profiles.some(profile => profile.id === selectedId);
    const isActive = selectedId === state.activeId;
    host.innerHTML = `
      <div class="ft-panel"><strong>我的 Profile</strong><div class="ft-muted">Reddit 与 X 共用当前选择</div>
        ${state.profiles.map(profile => `<button type="button" class="ft-row" data-action="select" data-id="${escape(profile.id)}" aria-selected="${profile.id === selectedId}">
          <strong>${escape(profile.name)}${profile.id === state.activeId ? ' · ✓ 当前' : ''}</strong>
          <span>${typeLabel(profile.provider)}${!complete(profile) ? ' · 待完善' : ''}</span></button>`).join('')}
        <button type="button" data-action="new">＋ 新建 Profile</button></div>
      <div class="ft-panel">
        <strong>${isNew ? '新建 Profile' : '编辑 Profile'}</strong>
        <label>Profile 名称<input data-field="name" value="${escape(draft.name)}" autocomplete="off"></label>
        <label>翻译类型<select data-field="provider">
          ${(['google','microsoft','ai'] as const).map(provider => `<option value="${provider}"${draft.provider === provider ? ' selected' : ''}>${typeLabel(provider)}</option>`).join('')}
        </select></label>
        ${draft.provider === 'ai' ? `
          <label>API 协议<select data-field="protocol">
            <option value="chat-completions"${draft.ai.protocol === 'chat-completions' ? ' selected' : ''}>Chat Completions</option>
            <option value="responses"${draft.ai.protocol === 'responses' ? ' selected' : ''}>Responses</option>
          </select></label>
          <label>API Base URL<input data-field="baseUrl" value="${escape(draft.ai.baseUrl)}" placeholder="https://api.example.com/v1">
            <div class="ft-muted">仅 HTTPS 或本机 loopback HTTP；自动拼接协议路径</div></label>
          <label>API Key（可留空）<div class="ft-inline">
            <input data-field="apiKey" type="${keyShown ? 'text' : 'password'}" autocomplete="off" value="${escape(draft.ai.apiKey)}">
            <button type="button" data-action="show-key">${keyShown ? '隐藏' : '显示'}</button>
          </div></label>
          <label>模型 ID<div class="ft-inline">
            <input data-field="model" list="ft-profile-models" value="${escape(draft.ai.model)}" placeholder="选择或手动填写">
            <button type="button" data-action="models">获取模型</button></div>
            <datalist id="ft-profile-models">${models.map(id => `<option value="${escape(id)}"></option>`).join('')}</datalist></label>
          <label>额外翻译要求<textarea data-field="prompt" placeholder="例如：保留技术术语">${escape(draft.ai.prompt)}</textarea></label>
          <details><summary>高级设置</summary>
            <label>每分钟请求数<input data-field="requestsPerMinute" type="number" min="1" max="1000000" value="${draft.ai.requestsPerMinute}"></label>
            <label>每分钟估算 Token 上限（0 不限制）<input data-field="tokensPerMinute" type="number" min="0" max="1000000" value="${draft.ai.tokensPerMinute}"></label>
            <label>思考深度<select data-field="reasoningEffort">
              ${(['auto','none','low'] as const).map(value => `<option value="${value}"${draft.ai.reasoningEffort === value ? ' selected' : ''}>${value}</option>`).join('')}
            </select></label>
            <label><input data-field="fastMode" type="checkbox"${draft.ai.fastMode ? ' checked' : ''} style="display:inline;width:auto;margin-right:5px">Fast 模式（服务商支持时）</label>
          </details>
          <button type="button" data-action="test">测试连接（发送真实短文本请求）</button>
        ` : '<div class="ft-muted">公共翻译服务无需 API Key 与模型配置。</div>'}
        ${message ? `<p role="status" class="ft-message">${escape(message)}</p>` : ''}
        <div class="ft-actions">
          <button type="button" class="ft-primary" data-action="save">保存配置</button>
          <button type="button" data-action="activate" ${isActive || isNew || !complete(draft) ? 'disabled' : ''}>设为当前</button>
          <button type="button" data-action="clone" ${isNew ? 'disabled' : ''}>复制</button>
          <button type="button" data-action="remove" ${isNew || state.profiles.length === 1 ? 'disabled' : ''}>删除</button>
        </div>
        <div class="ft-muted">${dirty ? '● 存在未保存的修改' : '当前标签页立即生效；其他标签页下次导航或刷新时更新。'}</div>
      </div>`;
  }
  function readFields(): void {
    host.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-field]').forEach(input => {
      const field = input.dataset.field;
      if (!field) return;
      const value: string | number | boolean = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked
        : input instanceof HTMLInputElement && input.type === 'number' ? Number(input.value) : input.value;
      if (field === 'name') draft.name = String(value);
      else if (field === 'provider' && ['google','microsoft','ai'].includes(String(value))) draft.provider = value as TranslationProvider;
      else if (field === 'baseUrl') draft.ai.baseUrl = String(value);
      else if (field === 'apiKey') draft.ai.apiKey = String(value);
      else if (field === 'model') draft.ai.model = String(value);
      else if (field === 'prompt') draft.ai.prompt = String(value);
      else if (field === 'protocol' && (value === 'responses' || value === 'chat-completions')) draft.ai.protocol = value;
      else if (field === 'requestsPerMinute') draft.ai.requestsPerMinute = Number(value);
      else if (field === 'tokensPerMinute') draft.ai.tokensPerMinute = Number(value);
      else if (field === 'reasoningEffort' && ['auto','low','none'].includes(String(value))) draft.ai.reasoningEffort = value as 'auto' | 'none' | 'low';
      else if (field === 'fastMode') draft.ai.fastMode = Boolean(value);
    });
  }
  function save(): boolean {
    try {
      readFields();
      draft.name = draft.name.trim();
      if (!draft.name) throw new Error('请填写 Profile 名称');
      if (draft.provider === 'ai') {
        if (draft.ai.baseUrl) draft.ai.baseUrl = normalizeAiBaseUrl(draft.ai.baseUrl);
        if (!Number.isInteger(draft.ai.requestsPerMinute) || draft.ai.requestsPerMinute < 1 || draft.ai.requestsPerMinute > 1000000)
          throw new Error('RPM 超出允许范围');
        if (!Number.isInteger(draft.ai.tokensPerMinute) || draft.ai.tokensPerMinute < 0 || draft.ai.tokensPerMinute > 1000000)
          throw new Error('TPM 超出允许范围');
      }
      draft = copy(upsertProfile(draft)); selectedId = draft.id; dirty = false; message = '配置保存成功';
      if (selectedId === listProfiles().activeId) onChanged();
      render(); return true;
    } catch (error) {
      message = error instanceof Error ? error.message : '配置保存失败'; render(); return false;
    }
  }
  const onInput = (event: Event): void => {
    if (!(event.target instanceof Element) || !event.target.hasAttribute('data-field')) return;
    readFields(); dirty = true;
  };
  const onChange = (event: Event): void => {
    const el = event.target;
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset.field === 'provider' || el.dataset.field === 'protocol') {
      readFields(); dirty = true; render();
    }
  };
  host.addEventListener('input', onInput);
  host.addEventListener('change', onChange);
  const onClick = async (event: Event): Promise<void> => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
    if (!target || !host.contains(target)) return;
    const action = target.dataset.action;
    if (action === 'select') { setSelected(target.dataset.id ?? ''); return; }
    if (action === 'new') {
      if (dirty && !confirm('放弃未保存的 Profile 修改？')) return;
      draft = makeProfile('google', '新建 Profile'); selectedId = draft.id; dirty = true; message = ''; models = []; render(); return;
    }
    if (action === 'show-key') {
      readFields(); keyShown = !keyShown; render(); return;
    }
    if (action === 'save') { save(); return; }
    if (action === 'activate') {
      if (dirty) { message = '请先保存当前修改'; render(); return; }
      try { if (draft.provider === 'ai') validateAiProfile(draft.ai); selectProfile(selectedId); onChanged(); message = '已切换 Profile'; render(); }
      catch (error) { message = error instanceof Error ? error.message : '切换失败'; render(); }
      return;
    }
    if (action === 'clone') {
      if (dirty && !confirm('放弃未保存的修改并复制已保存的 Profile？')) return;
      draft = copy(cloneProfile(selectedId)); selectedId = draft.id; dirty = false; message = '已复制，API Key 需要单独填写'; render(); return;
    }
    if (action === 'remove') {
      const state = listProfiles();
      const replacement = state.profiles.find(p => p.id !== selectedId && complete(p));
      if (selectedId === state.activeId && !replacement) { message = '请先创建另一个可用的 Profile'; render(); return; }
      if (!confirm('确定删除此 Profile？删除后无法恢复其专属配置与 API Key。')) return;
      try {
        removeProfile(selectedId, replacement?.id);
        selectedId = listProfiles().activeId; draft = copy(activeProfile()); dirty = false; message = 'Profile 已删除';
        if (state.activeId !== listProfiles().activeId) onChanged();
        render();
      } catch (error) { message = error instanceof Error ? error.message : '删除失败'; render(); }
      return;
    }
    if (action === 'models' || action === 'test') {
      readFields();
      if (draft.provider !== 'ai') return;
      request?.abort(); request = new AbortController();
      const controller = request;
      try {
        validateAiProfile(action === 'models' ? { ...draft.ai, model: 'models' } : draft.ai);
        message = action === 'test' ? '正在验证真实翻译请求…' : '正在获取模型…'; render();
        if (action === 'models') {
          const response = await requestJson(normalizeAiBaseUrl(draft.ai.baseUrl) + '/models', controller.signal, undefined, draft.ai.apiKey);
          const items = response && typeof response === 'object' && 'data' in response ? response.data : [];
          if (!Array.isArray(items)) throw new Error('模型列表格式不正确');
          models = [...new Set(items.flatMap(item => item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' ? [item.id] : []))].sort();
          message = models.length ? '成功获取 ' + models.length + ' 个模型' : '未获取到模型，可手动填写';
        } else {
          const translated = await translateAi('Hello world!', draft.ai, controller.signal);
          message = '连接测试成功：' + translated.slice(0, 80);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        message = (error instanceof Error ? error.message : '请求失败') + '；请检查接口、协议、模型或油猴权限';
      }
      render();
    }
  };
  host.addEventListener('click', onClick);
  render();
  return () => { disposed = true; request?.abort(); host.remove(); style.remove(); };
}
