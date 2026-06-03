import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/Gravity-Chess/' : '/',
  server: {
    host: '127.0.0.1',
    port: 5173
  }
});
