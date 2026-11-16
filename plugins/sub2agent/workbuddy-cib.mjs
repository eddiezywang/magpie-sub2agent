import {makePlugin, current, meter, reissued, _internal} from 'community-workbuddy-cib';

export const ID = 'sub2agent-workbuddy-cib';
export const DEFAULT_MODEL = 'glm-5.3-flash';
export const ORIGIN = 'https://webankcib.copilot.qq.com';
// Screenshot multipliers are reference values, not live prices or billing rates.
export const CATALOG = [
  ['glm-5.3-flash', 'GLM-5.3-flash', 0.06],
  ['deepseek-v4.1-flash', 'Deepseek-V4.1-Flash', 0.11],
  ['minimax-m3.1-flash', 'MiniMax-M3.1-Flash', 0.08],
  ['kimi-k2.8-preview', 'Kimi-K2.8-Preview', 0.77],
  ['glm-5.3', 'GLM-5.3', 0.79],
  ['glm-5.2-aicc', 'GLM-5.2 AICC', 1.58],
  ['kimi-k3.1-pro', 'Kimi-K3.1-Pro', 0.97],
  ['mimo-v2.6-pro', 'MiMo-V2.6-Pro', 0.18],
  ['space-bunny', 'Space-Bunny', 0.08],
  ['hy4', 'Hy4', 0.29],
];
const site = {
  ..._internal.SITES.workbuddy,
  id: ID, name: 'WorkBuddy CIB', endpoint: ORIGIN,
  authID: 'workbuddycib', platform: 'workbuddycib', app: '5.11.0',
  appName: 'workbuddycib', messages: false,
  models: CATALOG.map(([id, name]) => [id, name, 0, undefined, 0]),
  catalog: () => CATALOG.map(([id, name]) => ({id, name, images: false})),
};
const communityPlugin = makePlugin(site);

export default async function createCib(input) {
  const plugin = await communityPlugin(input);
  const configure = plugin.config;
  plugin.config = async config => {
    await configure(config);
    const provider = config.provider[ID];
    provider.icon = 'workbuddy-cib';
    for (const model of Object.values(provider.models)) {
      model.attachment = false;
      model.modalities = {input: ['text'], output: ['text']};
    }
  };
  plugin.auth.methods = plugin.auth.methods.slice(0, 1);
  plugin.auth.methods[0].label = 'CIB 企业账号（浏览器登录）';
  delete plugin.auth.checkin;
  plugin.auth.options = plugin.auth.options.filter(option => option.key !== _internal.FREE_ONLY);
  plugin.auth.usage = async getAuth => {
    try {
      const auth = await getAuth();
      if (auth?.type !== 'oauth' || !auth.access) return {error: '请先登录 WorkBuddy CIB', signIn: 'kept'};
      let account = await current(site, input.client, auth);
      let data, signIn = 'kept';
      const read = () => meter(site, account, '/v2/billing/meter/get-enterprise-user-usage');
      try { data = await read(); }
      catch (error) {
        if (error.status !== 401) throw error;
        const next = await reissued(site, input.client, getAuth, account, auth.access);
        if (!next.a) throw error;
        account = next.a;
        data = await read();
        signIn = 'renewed';
      }
      if (!Number.isFinite(data?.credit) || data.credit < 0 || !Number.isFinite(data?.limitNum) || data.limitNum <= 0)
        return {error: '积分余额未知：接口未返回有效额度', signIn};
      const window = _internal.enterpriseUsageOf(data);
      delete window.resetsAt;
      delete window.span;
      const remaining = Math.max(0, data.limitNum - data.credit);
      window.display = `剩余 ${Number(remaining.toFixed(4))} / ${data.limitNum}（已用 ${data.credit}）` +
        (data.cycleResetTime ? `；重置 ${data.cycleResetTime}` : '');
      return {plan: 'CIB 企业积分', windows: [window], signIn};
    } catch { return {error: 'CIB 积分余额查询失败', signIn: 'kept'}; }
  };
  const loader = plugin.auth.loader;
  plugin.auth.loader = async (...args) => {
    const loaded = await loader(...args);
    const fetch = loaded.fetch;
    if (!fetch) return loaded;
    loaded.fetch = async (url, init) => {
      const raw = init?.body ?? (url instanceof Request ? await url.clone().text() : undefined);
      if (typeof raw !== 'string') return fetch(url, init);
      let body;
      try { body = JSON.parse(raw); } catch { return fetch(url, init); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return fetch(url, init);
      if (!body.model || ['auto', 'default', 'default-model'].includes(body.model)) body.model = DEFAULT_MODEL;
      return fetch(url, {...init, body: JSON.stringify(body)});
    };
    return loaded;
  };
  return plugin;
}
