// Authentication has a bounded wait and product-facing connection errors.
// Inference keeps the original fetch and its own streaming lifetime.
export function loginNetwork(fetchImpl, currentSignal, timeoutMs = 12_000) {
  return async (url, opts = {}) => {
    const active = currentSignal();
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([deadline, active, opts.signal].filter(Boolean));
    let response;
    try {
      response = await fetchImpl(url, {...opts, signal});
      // Login endpoints return JSON, not inference streams. Read the body
      // within this deadline too, so headers alone cannot leave the sheet stuck.
      const body = await response.arrayBuffer();
      response = new Response(body.byteLength ? body : null, {status:response.status, statusText:response.statusText, headers:response.headers});
    } catch (error) {
      if (active?.aborted) throw active.reason;
      if (opts.signal?.aborted && opts.signal.reason?.name !== 'TimeoutError') throw opts.signal.reason;
      const code = error?.cause?.code || error?.code;
      if (deadline.aborted || signal.reason?.name === 'TimeoutError' || error?.name === 'TimeoutError' || ['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(code)) {
        throw new Error('连接供应商登录服务超时，请检查网络或 VPN 后重试。');
      }
      if (code === 'ECONNREFUSED') throw new Error('供应商登录服务拒绝连接，请稍后重试或联系服务管理员。');
      if (['ENOTFOUND','EAI_AGAIN'].includes(code)) throw new Error('无法解析供应商登录服务器地址，请检查网络或 DNS 配置后重试。');
      throw new Error('无法连接供应商登录服务，请检查网络或 VPN 后重试。');
    }
    if (response.status >= 500 || response.status === 404) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`供应商登录服务暂不可用（HTTP ${response.status}），请稍后重试或联系服务管理员。`);
    }
    return response;
  };
}
