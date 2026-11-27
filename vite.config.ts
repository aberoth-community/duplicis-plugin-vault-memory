import { defineConfig } from 'vite'
import obfuscate from 'vite-plugin-javascript-obfuscator'
import duplicis from '@duplicis/config/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [
    svelte(),
    duplicis('./src/index.ts'),
    obfuscate({
      apply: 'build',
      include: [/\.(?:[cm]?[jt]sx?|svelte)$/],
      options: { sourceMap: false },
    }),
  ],
  build: {
    sourcemap: false,
    cssTarget: 'chrome130',
    lib: { entry: './src/index.ts', fileName: () => 'index.js', cssFileName: 'vault' },
    rollupOptions: { external: [/^@duplicis\//, /^svelte(?:\/|$)/] },
  },
})
