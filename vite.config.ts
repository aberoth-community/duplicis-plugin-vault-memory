import { defineConfig } from 'vite'
import duplicis from '@duplicis/config/vite'

export default defineConfig({
  plugins: [duplicis('./src/index.ts')],
  build: {
    lib: { entry: './src/index.ts', fileName: () => 'index.js' },
  },
})
