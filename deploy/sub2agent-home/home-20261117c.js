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
document.addEventListener('click', e => { if (!e.target.closest('.platform')) { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); } });

const os = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
fetch('/wemail/sub2agent/downloads.json', {cache:'no-store'}).then(r => { if (!r.ok) throw Error('downloads'); return r.json(); }).then(data => {
  const entries = {windows:data.windows, arm64:data.macos?.['magpie-darwin-arm64.zip'], amd64:data.macos?.['magpie-darwin-amd64.zip']};
  for (const [key, value] of Object.entries(entries)) {
    const a = document.querySelector(`[data-platform="${key}"]`);
    if (!value?.url || !value?.version) { a.hidden = true; continue; }
    a.href = value.url; a.querySelector('small').textContent += ` · ${value.version}`;
  }
  if (/mac/i.test(os)) {
    label.textContent = '选择 macOS 版本'; system.textContent = '支持 Apple 芯片 / Intel 芯片';
    primary.href = '#download'; primary.removeAttribute('aria-disabled');
    primary.addEventListener('click', e => { e.preventDefault(); menu.hidden = false; toggle.setAttribute('aria-expanded','true'); });
  } else if (entries.windows?.url) {
    label.textContent = '下载 Windows 版'; system.textContent = `Windows · ${entries.windows.version}`;
    primary.href = entries.windows.url; primary.removeAttribute('aria-disabled');
  }
}).catch(() => { label.textContent = '暂时无法获取下载'; system.textContent = '请稍后刷新重试'; });
