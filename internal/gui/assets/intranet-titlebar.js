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
    'zh-CN': ['最小化', '最大化', '关闭', '还原'], 'zh-TW': ['最小化', '最大化', '關閉', '還原'],
    'ja-JP': ['最小化', '最大化', '閉じる', '元に戻す'], 'de-DE': ['Minimieren', 'Maximieren', 'Schließen', 'Wiederherstellen'],
  };
  const englishLabels = ['Minimize', 'Maximize', 'Close', 'Restore'];
  const labels = languageLabels[document.documentElement.lang] || englishLabels;
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
    button.addEventListener('click', async () => {
      const runtime = await winRuntime;
      if (!runtime) return;
      await runtime.Window[method]();
      if (method === 'ToggleMaximise') await updateMaximized();
    });
    controls.append(button);
  }
  actions.append(controls);
  let maximized = false;
  function updateLabels() {
    const current = languageLabels[document.documentElement.lang] || englishLabels;
    for (const [index, button] of [...controls.children].entries()) {
      const label = current[index === 1 && maximized ? 3 : index];
      button.setAttribute('aria-label', label);
      button.title = label;
    }
    controls.children[1].classList.toggle('restoring', maximized);
    controls.children[1].querySelector('path').setAttribute('d', maximized
      ? 'M6 2h8v8h-2V4H6zM2 6h9v8H2zm2 2v4h5V8z'
      : specs[1][2]);
  }
  async function updateMaximized() {
    const runtime = await winRuntime;
    if (runtime?.Window?.IsMaximised) {
      try {
        maximized = !!(await runtime.Window.IsMaximised());
        updateLabels();
      } catch { /* The window can disappear while a state read is pending. */ }
    }
  }
  new MutationObserver(updateLabels).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(updateMaximized, 100);
  });
  updateMaximized();
  document.querySelector('.top').addEventListener('dblclick', (event) => {
    if (!event.target.closest('button, nav')) winRuntime.then((runtime) => runtime?.Window.ToggleMaximise());
  });
  fitTop();
})();
