import { MAX_SOURCE_LENGTH, MAX_EDGES } from './limits.js';
let engine;
async function getEngine() {
  if (!engine)
    engine = import('mermaid')
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          maxTextSize: MAX_SOURCE_LENGTH,
          maxEdges: MAX_EDGES,
          secure: [
            'secure',
            'securityLevel',
            'startOnLoad',
            'maxTextSize',
            'maxEdges',
            'suppressErrorRendering',
          ],
          theme: 'neutral',
          themeVariables: {
            primaryColor: '#f5f5f7',
            primaryTextColor: '#000000',
            textColor: '#000000',
            secondaryTextColor: '#000000',
            tertiaryTextColor: '#000000',
            gitBranchLabel0: '#000000',
            ...Object.fromEntries(
              Array.from({ length: 12 }, (_, index) => ['cScaleLabel' + index, '#000000']),
            ),
            primaryBorderColor: '#86868b',
            lineColor: '#a1a1a6',
            fontFamily: 'Helvetica Neue, PingFang SC, sans-serif',
          },
        });
        return mermaid;
      })
      .catch((error) => {
        engine = undefined;
        throw error;
      });
  return engine;
}
export function createRenderer(preview, report) {
  let version = 0,
    timer,
    svg = '',
    chain = Promise.resolve();
  const render = (source) => {
    const current = ++version;
    svg = '';
    chain = chain.then(async () => {
      if (current !== version) return;
      try {
        if (source.length > MAX_SOURCE_LENGTH) throw Error('代码超过 2 MB 字符限制，请拆分导图');
        const mermaid = await getEngine();
        if (current !== version) return;
        const result = await mermaid.render('diagram-' + current, source);
        if (current !== version) return;
        preview.innerHTML = result.svg;
        svg = result.svg;
        report('预览已更新');
      } catch (error) {
        if (current !== version) return;
        preview.textContent = '无法渲染当前代码，请检查 Mermaid 语法或图的规模。';
        report('渲染失败：' + String(error.message || error).slice(0, 300));
      }
    });
    return chain;
  };
  return {
    invalidate() {
      clearTimeout(timer);
      ++version;
      svg = '';
    },
    schedule(source) {
      clearTimeout(timer);
      ++version;
      svg = '';
      timer = setTimeout(() => render(source), 250);
    },
    render(source) {
      clearTimeout(timer);
      return render(source);
    },
    // Parsing and rendering share Mermaid's mutable diagram databases.
    // Convert inside the same queue before another job can clear the database.
    parse(source, convert) {
      const result = chain.then(async () => {
        if (source.length > MAX_SOURCE_LENGTH) throw Error('代码超过 2 MB 字符限制，请拆分导图');
        const mermaid = await getEngine();
        const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
        return convert(diagram);
      });
      chain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    getSvg: () => svg,
  };
}
