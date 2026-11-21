const menu = document.querySelector('#menu');
const toggle = document.querySelector('#toggle');
const primary = document.querySelector('#primary');
const label = document.querySelector('#primary-label');
const system = document.querySelector('#system');
const field = document.querySelector('#pixel-field');

function scatter(seed = 0) {
  field.replaceChildren();
  for (let i = 0; i < 24; i++) {
    const pixel = document.createElement('span');
    pixel.className = 'pixel';
    pixel.style.left = `${9 + ((i * 43 + seed * 17) % 82)}%`;
    pixel.style.top = `${7 + ((i * 67 + seed * 23) % 86)}%`;
    pixel.style.animationDelay = `${-(i % 8) * .35}s`;
    field.append(pixel);
  }
}
scatter();
toggle.addEventListener('click', () => { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded', String(!menu.hidden)); });
document.addEventListener('click', e => { if (!e.target.closest('.platform, #primary')) { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); } });

const base = '/wemail/sub2agent/';
const windowsDownload = 'http://172.21.0.177:18989/sub2agent/releases/latest/windows-amd64';
const os = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
const mac = /mac/i.test(os);
const windows = document.querySelector('[data-platform="windows"]');

async function getJSON(url) {
  const response = await fetch(url, {cache:'no-store'});
  if (!response.ok) throw new Error('下载信息不可用');
  return response.json();
}

windows.href = windowsDownload;
if (!mac) {
  label.textContent = '下载 Windows 版';
  system.textContent = 'Windows · 64 位';
  primary.href = windowsDownload;
  primary.removeAttribute('aria-disabled');
}

const macDownloads = {arm64:'magpie-darwin-arm64.zip', amd64:'magpie-darwin-amd64.zip'};
for (const key of Object.keys(macDownloads)) document.querySelector(`[data-platform="${key}"]`).hidden = true;
getJSON(base + 'downloads.json').then(data => {
  let hasMac = false;
  for (const [key, asset] of Object.entries(macDownloads)) {
    const value = data.macos?.[asset];
    if (!value?.url || !value?.version) continue;
    const link = document.querySelector(`[data-platform="${key}"]`);
    link.href = value.url;
    link.querySelector('small').textContent += ` · ${value.version}`;
    link.hidden = false;
    hasMac = true;
  }
  if (mac && hasMac) {
    label.textContent = '选择 macOS 版本';
    system.textContent = '支持 Apple 芯片 / Intel 芯片';
    primary.href = '#download';
    primary.removeAttribute('aria-disabled');
    primary.addEventListener('click', e => { e.preventDefault(); menu.hidden = false; toggle.setAttribute('aria-expanded','true'); });
  } else if (mac) {
    throw new Error('没有可用的 Mac 安装包');
  }
}).catch(() => {
  if (!mac) return;
  label.textContent = '暂时无法获取下载';
  system.textContent = '请稍后刷新重试';
});
