import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { deploymentConfig } from './deployment.config.mjs';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: deploymentConfig.frontendHost,
    port: deploymentConfig.frontendPort,
    open: true,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_BASE_URL || deploymentConfig.backendBaseUrl,
        changeOrigin: true,
      },
      '/erp': {
        target: process.env.VITE_BACKEND_BASE_URL || deploymentConfig.backendBaseUrl,
        changeOrigin: true,
      },
    },
  },
});
