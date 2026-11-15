// This layer stays dormant until the native host explicitly provides a
// matching frameless window. The preview can opt in with synthetic data.
(() => {
  if (!window.bootPrefs?.retroFrame || !document.body.classList.contains('window')) return;
  const brand = document.querySelector('.brand');
  const name = brand?.querySelector('span:not(.logo)');
  const actions = document.querySelector('.top .actions');
  if (!brand || !name || !actions) return;
  document.body.classList.add('retro-frame');
  name.classList.add('retro-wordmark');
  name.setAttribute('aria-label', 'Sub2Agent');
  const languageLabels = {
    'zh-CN': ['最小化', '最大化', '关闭'], 'zh-TW': ['最小化', '最大化', '關閉'],
    'ja-JP': ['最小化', '最大化', '閉じる'], 'de-DE': ['Minimieren', 'Maximieren', 'Schließen'],
  };
  const labels = languageLabels[document.documentElement.lang] || ['Minimize', 'Maximize', 'Close'];
  const specs = [
    [labels[0], 'Minimise', 'M3 11h10v2H3z'],
    [labels[1], 'ToggleMaximise', 'M3 3h10v2H3zm0 8h10v2H3zM3 5h2v6H3zm8 0h2v6h-2z'],
    [labels[2], 'Close', 'M3 3h2v2H3zm8 0h2v2h-2zM5 5h2v2H5zm4 0h2v2H9zM7 7h2v2H7zM5 9h2v2H5zm4 0h2v2H9zm-6 2h2v2H3zm8 0h2v2h-2z'],
  ];
  const controls = document.createElement('div');
  controls.className = 'retro-window-controls';
  controls.style.setProperty('--wails-draggable', 'no-drag');
  for (const [label, method, drawing] of specs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'retro-window-button' + (method === 'Close' ? ' close' : '');
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${drawing}"/></svg>`;
    button.addEventListener('click', () => winRuntime.then((runtime) => runtime?.Window[method]()));
    controls.append(button);
  }
  actions.append(controls);
  new MutationObserver(() => {
    const current = languageLabels[document.documentElement.lang] || ['Minimize', 'Maximize', 'Close'];
    for (const [index, button] of [...controls.children].entries()) {
      button.setAttribute('aria-label', current[index]);
      button.title = current[index];
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  document.querySelector('.top').addEventListener('dblclick', (event) => {
    if (!event.target.closest('button, nav')) winRuntime.then((runtime) => runtime?.Window.ToggleMaximise());
  });
  fitTop();
})();
