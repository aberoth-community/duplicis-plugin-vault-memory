import { defineConfig } from 'vite'
import obfuscate from 'vite-plugin-javascript-obfuscator'
import duplicis from '@duplicis/config/vite'

export default defineConfig({
  plugins: [
    duplicis('./src/index.ts'),
    obfuscate({
      apply: 'build',
      include: [/\.(?:[cm]?[jt]sx?|svelte)$/],
      options: { sourceMap: false },
    }),
  ],
  build: {
    sourcemap: false,
    lib: { entry: './src/index.ts', fileName: () => 'index.js' },
  },
})
