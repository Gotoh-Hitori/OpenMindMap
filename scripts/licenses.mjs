import fs from 'node:fs';
import path from 'node:path';
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
let count = 0;
let notice =
  '# Third-party notices\n\n本文件保留当前锁文件非 dev 安装路径的第三方许可文本；保守覆盖安装树，不代表每个包都会进入浏览器 bundle。OpenMindMap 自有代码采用 GNU GPL-3.0-only；第三方代码仍按各自原有许可提供。更新依赖后运行 `npm run licenses` 重新生成。\n\n原文来自 npm 安装包的 LICENSE、COPYING、NOTICE 或 README 的 License 章节。构建会把本文件与 LICENSE 一同分发到 dist。\n\n';
for (const [key, value] of Object.entries(lock.packages)) {
  if (!key || value.dev || !key.startsWith('node_modules/')) continue;
  const manifest = JSON.parse(fs.readFileSync(path.join(key, 'package.json'), 'utf8'));
  const names = fs
    .readdirSync(key)
    .filter(
      (name) =>
        /^(licen[sc]e|copying|notice)(\.|$)/i.test(name) &&
        fs.statSync(path.join(key, name)).isFile(),
    );
  let bodies = names.map((name) => ({ name, text: fs.readFileSync(path.join(key, name), 'utf8') }));
  if (!bodies.length) {
    const readme = fs.readFileSync(path.join(key, 'README.md'), 'utf8');
    const match = readme.match(/^## License\s*$/m);
    if (!match) throw Error('Missing license text: ' + manifest.name);
    bodies = [{ name: 'README.md (License section)', text: readme.slice(match.index) }];
  }
  let license = manifest.license || 'unspecified';
  if (license === 'unspecified' && bodies.some((body) => /The MIT License/.test(body.text)))
    license = 'MIT (license file; absent from package manifest)';
  notice += `## ${manifest.name} ${manifest.version}\n\nPackage: \`${key}\`\n\nDeclared license: ${typeof license === 'string' ? license : JSON.stringify(license)}\n\n`;
  for (const body of bodies)
    notice += `### ${body.name}\n\n~~~text\n${body.text.replace(/\r\n/g, '\n')}\n~~~\n\n`;
  ++count;
}
fs.writeFileSync('THIRD_PARTY_NOTICES.md', notice);
console.log('Generated license notices for ' + count + ' runtime package paths.');
