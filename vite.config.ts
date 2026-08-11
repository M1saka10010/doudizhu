import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 相对资源路径可同时部署到根域名、GitHub Pages 子目录或任意静态目录。
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
  },
});
