// Only imported by the CIB ZHT provider editor. No CLI output is displayed.
export function setup(wrap, key) {
  const box = document.createElement("section");
  box.className = "coding-plan-notice";
  const hint = document.createElement("p");
  hint.textContent = "已有 API Key 可直接填写。若不知道 Key 但已获访问权限，可通过智汇通 CLI 登录获取；仅读取 apiKeyId 包含 8899 的有效密钥。";
  const command = document.createElement("code");
  command.textContent = "npm install -g @webank/zht-dt-cli --registry=http://wnpm.weoa.com:8001";
  const note = document.createElement("p");
  note.textContent = "首次使用先安装 CLI。点击获取后，CLI 会按其登录流程授权；应用捕获并解析结果，不显示明文输出，也不会自动升级 CLI。请勿转发 CLI 的明文输出。";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text";
  button.textContent = "通过 CLI 登录并获取 Key";
  const status = document.createElement("p");
  status.className = "hint";
  const choices = document.createElement("div");
  const choose = (item) => {
    if (!key.isConnected) return;
    key.value = item.apiKeyValue;
    key.dispatchEvent(new Event("input", {bubbles: true}));
    choices.replaceChildren();
    status.textContent = `已填入 ${item.apiKeyId}，保存供应商后生效。`;
  };
  button.onclick = async () => {
    button.disabled = true;
    choices.replaceChildren();
    status.textContent = "正在等待 CLI 完成登录并读取密钥…";
    try {
      const result = await api("provider-zht/key", {});
      if (!box.isConnected) return;
      if (result.keys.length === 1) choose(result.keys[0]);
      else {
        status.textContent = "找到多个 8899 密钥，请选择：";
        for (const item of result.keys) {
          const pick = document.createElement("button");
          pick.type = "button";
          pick.className = "text";
          pick.textContent = item.apiKeyId;
          pick.onclick = () => choose(item);
          choices.append(pick);
        }
      }
    } catch (error) {
      status.textContent = error.message || "获取失败，请重试或直接填写 API Key。";
    } finally { button.disabled = false; }
  };
  box.append(hint, command, note, button, status, choices);
  wrap.after(box);
}
