import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const injectedBearer = env.VITE_ACP_API_TOKEN?.trim() ?? process.env.ACP_API_TOKEN?.trim();

  return {
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3840',
          changeOrigin: true,
          configure(proxy) {
            proxy.on('proxyReq', (proxyReq, req) => {
              const incoming = req.headers.authorization;
              if (incoming) {
                proxyReq.setHeader('Authorization', incoming);
              } else if (injectedBearer) {
                proxyReq.setHeader('Authorization', `Bearer ${injectedBearer}`);
              }
            });
          },
        },
      },
    },
  };
});
