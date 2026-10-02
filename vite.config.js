import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
export default defineConfig({
  plugins: [
    {
      name: 'distribute-license-notices',
      generateBundle() {
        for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
          this.emitFile({
            type: 'asset',
            fileName: name,
            source: readFileSync(new URL(name, import.meta.url), 'utf8'),
          });
        }
      },
    },
  ],
});
