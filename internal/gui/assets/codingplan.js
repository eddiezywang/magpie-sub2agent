// Institutional instructions stay with this provider rather than the core script.
export function notice(editor) {
  const box = document.createElement("section");
  box.className = "coding-plan-notice";
  const title = document.createElement("strong");
  title.textContent = "大模型运维助手 · 企微安全须知";
  box.append(title);
  for (const text of [
    "您好！您申请的公有云大模型密钥已下发，请严格遵守以下安全要求：",
    "1. 仅限非敏感代码，仅用于不包含敏感代码的系统研发；",
    "2. 严禁上传重要数据、一级数据、业务数据、客户信息、系统设计文档等敏感资料，或使用本服务处理涉及商业秘密、客户隐私及国家安全的相关信息，涉及敏感数据请用行内专有云服务；",
    "3. 违规需自行担责并接受严肃处理，请妥善保管密钥，切勿泄露、转借。",
    "地址填写网关 http://172.21.11.82/public，不要追加 /v1/messages。应用会自动拼接请求路径，并使用 Authorization: Bearer 鉴权。",
    "API Key 请填写 AIEP 平台申请的 Coding Plan Key（别名含 codeplan / codingplan）；可在平台申请密钥或查看剩余额度。",
  ]) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    box.append(paragraph);
  }
  for (const [label, url] of [
    ["AIEP · 申请密钥 / 剩余额度", "https://aiep.weoa.com"],
    ["查看使用说明 ↗", "http://docs.weoa.com/docs/47kgJOEB8WTo77qV"],
  ]) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "link";
    link.textContent = label;
    link.onclick = () => api("open", {url});
    box.append(link);
  }
  editor.querySelector(".ehead").after(box);
}
