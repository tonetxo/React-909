import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: './',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
          manifest: {
            name: 'O Grove Son',
            short_name: 'Grove Son',
            description: 'Unha caixa de ritmos (groovebox) e secuenciador por pasos baseada na web.',
            theme_color: '#facc15', // yellow-400
            background_color: '#111827', // gray-900
            icons: [
              {
                src: 'pwa-192x192.png',
                sizes: '192x192',
                type: 'image/png',
              },
              {
                src: 'pwa-512x512.png',
                sizes: '512x512',
                type: 'image/png',
              },
              {
                src: 'pwa-512x512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any maskable',
              },
            ],
          },
        }),
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
            'clock-processor': path.resolve(__dirname, 'services/clock-processor.ts'),
            'vocoder-processor': path.resolve(__dirname, 'services/vocoder-processor.ts'),
            'vocoder-processor-new': path.resolve(__dirname, 'services/vocoder-processor-new.ts'),
          },
          output: {
            entryFileNames: (chunkInfo) => {
              if (chunkInfo.name === 'vocoder-processor' || chunkInfo.name === 'vocoder-processor-new' || chunkInfo.name === 'clock-processor') {
                return `services/[name].js`;
              }
              return `assets/[name]-[hash].js`;
            },
          },
        },
      }
    };
});
