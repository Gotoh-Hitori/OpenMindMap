export function setupViews({ onCanvas, onOutput }) {
  const canvas = document.getElementById('canvas-view');
  const output = document.getElementById('output-view');
  const canvasButton = document.getElementById('view-canvas');
  const outputButton = document.getElementById('view-output');
  function show(view) {
    const isCanvas = view === 'canvas';
    document.body.dataset.view = view;
    canvas.hidden = !isCanvas;
    output.hidden = isCanvas;
    for (const [button, active] of /** @type {[HTMLElement, boolean][]} */ ([
      [canvasButton, isCanvas],
      [outputButton, !isCanvas],
    ])) {
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    if (isCanvas) requestAnimationFrame(onCanvas);
    else requestAnimationFrame(onOutput);
  }
  canvasButton.onclick = () => show('canvas');
  outputButton.onclick = () => show('output');
  document.addEventListener('click', (event) => {
    for (const menu of document.querySelectorAll('.file-menu[open],.help[open]')) {
      if (!menu.contains(/** @type {Node} */ (event.target)))
        /** @type {HTMLDetailsElement} */ (menu).open = false;
    }
  });
  let timer;
  return {
    show,
    notify(text) {
      const status = document.getElementById('status');
      if (text === '预览已更新' && status.textContent && !status.textContent.startsWith('渲染失败'))
        return;
      status.textContent = text;
      status.classList.remove('quiet');
      clearTimeout(timer);
      if (text === '预览已更新') status.classList.add('quiet');
      else timer = setTimeout(() => status.classList.add('quiet'), 6000);
    },
  };
}
