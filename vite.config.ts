import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      // ✅ SEGURIDAD: GEMINI_API_KEY ya NO se expone al frontend.
      // La API key vive exclusivamente en el servidor (server/index.ts).
      // Solo exponemos variables VITE_* que sean seguras para el cliente.
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        // Redirigir /api/* al servidor Express backend (puerto 3001)
        '/api': {
          target: `http://localhost:${env.API_PORT || 3001}`,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
