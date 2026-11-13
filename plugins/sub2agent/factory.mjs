// Magpie owns the sheets, accounts and gateway. Private Sub2Agent modules
// are supplied by build/sub2agent-providers.mjs from the authorized checkout.
import { createCodeBuddySubscriptionAdapter } from 'sub2agent/core/source-adapters/codebuddy-subscription-adapter';
import { loginNetwork } from './login-network.mjs';
import { createWorkBuddySubscriptionAdapter } from 'sub2agent/core/source-adapters/workbuddy-subscription-adapter';
import { createTraeSubscriptionAdapter } from 'sub2agent/core/source-adapters/trae-subscription-adapter';
import { createCodeBuddySubscriptionResolver } from 'sub2agent/core/source-resolvers/codebuddy-subscription-resolver';
import { createWorkBuddySubscriptionResolver } from 'sub2agent/core/source-resolvers/workbuddy-subscription-resolver';
import { createTraeSubscriptionResolver } from 'sub2agent/core/source-resolvers/trae-subscription-resolver';
import { createWorkBuddyCredentialService } from 'sub2agent/core/workbuddy-credential-service';
import { createTraeCredentialService } from 'sub2agent/core/trae-credential-service';
import { createKernelWithDefaults } from 'sub2agent/protocol-kernel/default-kernel';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const names = { codebuddy: 'CodeBuddy', workbuddy: 'WorkBuddy 企业', trae: 'Trae 企业' };
const icons = { codebuddy: 'codebuddy-color', workbuddy: 'workbuddy-color', trae: 'trae' };
const modelSet = models => Object.fromEntries((models || []).map(id => [id, { name: id }]));

export function readBundle(auth) {
  if (!auth?.access) throw new Error('请先登录此供应商。');
  let bundle;
  try { bundle = JSON.parse(auth.access); } catch { throw new Error('订阅凭据格式无效，请重新登录。'); }
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new Error('订阅凭据格式无效。');
  return bundle;
}

function success(bundle) {
  return { type: 'success', access: JSON.stringify(bundle), refresh: '',
    expires: 0, accountId: String(bundle.userId || randomUUID()) };
}

// CodeBuddy's adapter normally writes the IDE's auth file. Use an isolated
// in-memory file here; only Magpie's account-scoped auth store persists it.
function codeBuddyAdapter(fetchImpl) {
  const files = new Map();
  const fsImpl = {
    constants: { R_OK: 4 }, mkdirSync() {},
    writeFileSync: (p, data) => files.set(p, data),
    readFileSync(p) { if (!files.has(p)) throw new Error('no auth file'); return files.get(p); },
    accessSync(p) { if (!files.has(p)) throw new Error('no auth file'); },
    statSync(p) { if (!files.has(p)) throw new Error('no auth file'); return {isFile:()=>true,mtimeMs:Date.now()}; },
  };
  return createCodeBuddySubscriptionAdapter({fetchImpl,fsImpl,authFile:'/sub2agent-auth.json'});
}

async function poll(signal, run) {
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until) {
    signal?.throwIfAborted();
    const result = await run();
    if (result) return result;
    await delay(1500, undefined, {signal});
  }
  throw new Error('登录已超时，请重新打开登录页面。');
}

export async function createSub2AgentPlugin(kind, input, deps = {}) {
  if (!names[kind]) throw new Error('Unknown Sub2Agent provider');
  const id = 'sub2agent-' + kind;
  const rawFetch = deps.fetchImpl || globalThis.fetch;
  // Private resolvers replace credentials after a 401 using canonical header
  // names; the protocol executor may already have lowercased them. HTTP names
  // are case-insensitive: keep the last value instead of combining two tokens.
  const fetchImpl = (url, init, context) => {
    if (!init?.headers) return rawFetch(url, init, context);
    const headers = new Map();
    const entries = init.headers instanceof Headers || Array.isArray(init.headers)
      ? init.headers : Object.entries(init.headers);
    for (const [name, value] of entries) headers.set(name.toLowerCase(), [name, value]);
    return rawFetch(url, {...init, headers:Object.fromEntries(headers.values())}, context);
  };
  const cb = kind === 'codebuddy' ? (deps.codebuddyAdapter || codeBuddyAdapter(fetchImpl)) : null;
  const wb = deps.workbuddyAdapter || createWorkBuddySubscriptionAdapter({fetchImpl});
  const trae = deps.traeAdapter || createTraeSubscriptionAdapter({fetchImpl});
  const initial = cb ? await cb.inspectLocalState() : {models:[]};

  async function authorize(_inputs, {signal} = {}) {
    let activeSignal = signal;
    // The host's sign-in signal is also used by the adapter's HTTP calls.
    const network = loginNetwork(fetchImpl, () => activeSignal);
    if (kind === 'codebuddy') {
      const adapter = deps.codebuddyAdapter || codeBuddyAdapter(network);
      const login = await adapter.requestLoginLink();
      return {url:login.url,method:'auto',instructions:'在浏览器完成 CodeBuddy 企业授权，窗口会自动更新。',
        callback: async (_code, {signal: finishSignal} = {}) => { activeSignal = finishSignal; return poll(finishSignal, async () => {
          let state;
          try { state = await adapter.completeLogin({state:login.state}); }
          catch (e) { if (String(e.message).includes('未完成授权')) return null; throw e; }
          const credentials = await adapter.confirmLoginComplete();
          return success({...credentials,models:state.models,defaultModel:state.defaultModel});
        }); }};
    }
    if (kind === 'workbuddy') {
      const adapter = deps.workbuddyAdapter || createWorkBuddySubscriptionAdapter({fetchImpl:network});
      const login = await adapter.requestLoginLink();
      let pendingToken = null;
      let tokenRequest = null;
      const readToken = async () => {
        if (pendingToken) return pendingToken;
        tokenRequest ||= Promise.resolve().then(() => adapter.pollToken(login.state))
          .then(token => (pendingToken ||= token)).finally(() => {tokenRequest = null;});
        return tokenRequest;
      };
      return {url:login.url,method:'auto',instructions:'请完成企业 SSO 登录，应用会自动识别。也可粘贴浏览器最后跳转的完整 WorkBuddy 回调地址，立即检查授权结果。',
        submitCallback: async raw => {
          let url;
          try {url = new URL(String(raw).trim());} catch {throw new Error('请粘贴完整的 WorkBuddy 回调地址。');}
          if (url.origin !== 'https://www.workbuddy.cn' || !['/login','/login/'].includes(url.pathname) ||
              url.username || url.password || url.hash || url.searchParams.getAll('state').length !== 1 ||
              url.searchParams.get('state') !== login.state || url.searchParams.get('platform') !== 'workbuddy') {
            throw new Error('此地址不属于本次 WorkBuddy 企业登录，请粘贴当前登录页面最后跳转的完整地址。');
          }
          // The official return page carries state, not a token. Re-check that
          // session at the trusted API; never fetch a user-supplied callback URL.
          await readToken();
        },
        callback: async (_code, {signal: finishSignal} = {}) => { activeSignal = finishSignal; return poll(finishSignal, async () => {
          const token = await readToken();
          if (!token) return null;
          pendingToken = token;
          let bundle;
          try { bundle = await adapter.resolveAccount(login.state,token); }
          catch (e) { if (Number(e.code) === 12151) return null; throw e; }
          return success({...bundle,...await adapter.listModels(bundle)});
        }); }};
    }
    const callbackPath = '/authorize/' + randomUUID();
    const traeLogin = deps.traeAdapter || createTraeSubscriptionAdapter({fetchImpl:network});
    let settle, reject;
    const received = new Promise((yes,no) => {settle=yes;reject=no;});
    received.catch(() => {});
    let accepted = false;
    const server = http.createServer((req,res) => {
      const url = new URL(req.url,'http://127.0.0.1');
      if (req.method !== 'GET' || url.pathname !== callbackPath) {res.writeHead(404);res.end();return;}
      if (accepted) {res.writeHead(409);res.end('Authorization already received');return;}
      try {
        const result = traeLogin.parseAuthorizationCallback(url.href);
        accepted = true;
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
        res.end('<title>Sub2Agent</title>授权已接收，可以返回 Sub2Agent。');
        settle(result);
      } catch {res.writeHead(400);res.end('Invalid authorization callback');}
    });
    await new Promise((yes,no) => {server.once('error',no);server.listen(0,'127.0.0.1',yes);});
    const timeout = setTimeout(() => {reject(new Error('Trae 登录已超时。'));server.close();},300_000);
    timeout.unref?.();
    const close = () => {clearTimeout(timeout);server.close();};
    const callbackUrl = `http://127.0.0.1:${server.address().port}${callbackPath}`;
    let login;
    try {login = await traeLogin.requestLoginLink({callbackUrl});}
    catch (error) {close();throw error;}
    return {url:login.loginUrl,callbackUrl,method:'auto',instructions:'正在监听本地回调。请在浏览器完成 Trae 企业登录；如未自动完成，可在下方粘贴浏览器最后跳转的完整回调地址。',
      callback:async (_code,{signal:finishSignal}={}) => {
        activeSignal = finishSignal;
        const abort = () => {reject(finishSignal.reason || new Error('登录已取消。'));close();};
        finishSignal?.addEventListener('abort',abort,{once:true});
        if(finishSignal?.aborted)abort();
        try {
          const bundle = await received;
          const user = await traeLogin.getUserInfo(bundle);
          const loginState = await traeLogin.checkLogin(bundle);
          if (loginState?.IsLogin !== true) throw new Error('Trae 企业登录校验未通过。');
          const models = await traeLogin.listModels(bundle);
          return success({...bundle,...models,userId:loginState.UserID || user.UserID || bundle.userId});
        } finally {finishSignal?.removeEventListener('abort',abort);close();}
      }};
  }

  return {
    config:async cfg => {
      cfg.provider ??= {};
      cfg.provider[id] = {name:names[kind],icon:icons[kind],npm:'@ai-sdk/openai-compatible',
        api:'https://sub2agent.invalid/v1',models:modelSet(initial.models)};
    },
    provider:{id,async models(provider,{auth}={}) {
      if(!auth?.access)return provider.models;
      return modelSet(readBundle(auth).models);
    }},
    auth:{provider:id,methods:[{type:'oauth',label:kind==='workbuddy'?'企业 SSO 扫码登录':'浏览器授权登录',authorize}],
      loader:async getAuth => {
        const store = {
          async getSecret() {const b=readBundle(await getAuth());return kind==='codebuddy'?b.accessToken:JSON.stringify(b);},
          async updateSecret(_ref,{secret}) {
            const old=await getAuth(),bundle={...readBundle(old),...JSON.parse(secret)};
            await input.client.auth.set({path:{id},body:{...old,access:JSON.stringify(bundle)}});
          },
        };
        const workbuddyCredentialService=createWorkBuddyCredentialService({secretStore:store,adapter:wb});
        const traeCredentialService=createTraeCredentialService({secretStore:store,traeAdapter:trae});
        const resolver=kind==='codebuddy'?createCodeBuddySubscriptionResolver({secretStore:store}):
          kind==='workbuddy'?createWorkBuddySubscriptionResolver({workbuddyCredentialService,fetchImpl}):
          createTraeSubscriptionResolver({traeCredentialService});
        const kernel=createKernelWithDefaults({executor:{async execute({source,request,signal,trace}) {
          const headers=new Headers({...source.headers,...request.config?.headers});
          if(source.apiKey&&!headers.has('Authorization'))headers.set('Authorization','Bearer '+source.apiKey);
          if(!headers.has('Content-Type'))headers.set('Content-Type','application/json');
          const url=source.baseUrl.replace(/\/+$/,'')+'/'+String(request.config?.path||source.path).replace(/^\/+/, '');
          return (source.fetch||fetchImpl)(url,{method:request.config?.method||'POST',headers:Object.fromEntries(headers),
            body:JSON.stringify(request.body||{}),signal},{traceId:trace?.id});
        }}});
        return {apiKey:'sub2agent-account',baseURL:'https://sub2agent.invalid/v1',async fetch(_url,init) {
          const bundle=readBundle(await getAuth());
          const source=await resolver.resolve({id,kind:'subscription',provider:kind,models:bundle.models,
            defaultModel:bundle.defaultModel,auth:{secretRef:id},subscription:bundle});
          // Magpie translates the client's protocol to Chat before handing
          // the request to this plugin; Sub2Agent handles the private wire.
          return kernel.execute({entrypoint:'/v1/chat/completions',body:JSON.parse(init.body),source,signal:init.signal});
        }};
      }},
  };
}
