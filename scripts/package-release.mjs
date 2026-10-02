import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
const root = process.cwd();
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Expected a stable version');
const release = path.join(root, 'releases', 'v' + version);
fs.mkdirSync(release, { recursive: true });
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
function walk(folder) {
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw Error('Symlinks are not allowed in release archives');
      return entry.isDirectory() ? walk(file) : [file];
    })
    .sort();
}
function zip(filename, entries) {
  const local = [],
    central = [];
  let offset = 0;
  for (const [name, file] of entries) {
    const bytes = fs.readFileSync(file),
      packed = deflateRawSync(bytes),
      filename = Buffer.from(name.replaceAll('\\', '/'));
    const crc = crc32(bytes),
      header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, packed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    header.copy(record, 6, 4, 30);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + packed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(filename, Buffer.concat([...local, directory, end]));
}
const firstParty = ['src', 'tests', 'scripts', '.github'].flatMap((folder) => walk(folder));
const rootFiles = [
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.js',
  'vercel.json',
  'playwright.config.js',
  'eslint.config.js',
  'tsconfig.json',
  '.prettierrc.json',
  '.prettierignore',
  '.editorconfig',
  '.gitignore',
  '.gitattributes',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'TESTING.md',
  'CHANGELOG.md',
  'RELEASE_AUDIT.md',
  'RELEASE_V1.md',
  'API_USAGE.md',
];
const source = [...firstParty, ...rootFiles].filter((file) => !file.endsWith('preview.png'));
for (const file of source) if (!fs.existsSync(file)) throw Error('Release input missing: ' + file);
for (const file of ['dist/index.html', 'dist/LICENSE', 'dist/THIRD_PARTY_NOTICES.md'])
  if (!fs.existsSync(file)) throw Error('Build first: missing ' + file);
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
  if (!fs.readFileSync(name).equals(fs.readFileSync(path.join('dist', name))))
    throw Error('Outdated build notice: ' + name);
const names = ['openmindmap-v' + version + '-source.zip', 'openmindmap-v' + version + '-dist.zip'];
zip(
  path.join(release, names[0]),
  source.map((file) => [
    'openmindmap-v' + version + '/' + path.relative(root, path.resolve(file)),
    file,
  ]),
);
zip(
  path.join(release, names[1]),
  walk('dist').map((file) => [path.relative('dist', file), file]),
);
const sums =
  names
    .map(
      (name) =>
        createHash('sha256')
          .update(fs.readFileSync(path.join(release, name)))
          .digest('hex') +
        '  ' +
        name,
    )
    .join('\n') + '\n';
fs.writeFileSync(path.join(release, 'SHA256SUMS'), sums);
console.log(path.relative(root, release) + ': ' + names.join(', ') + ', SHA256SUMS');
