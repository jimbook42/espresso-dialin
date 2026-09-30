import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:flair-lab` uses HTTPS so a phone on the bench can open the front camera.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'flairlab' ? basicSsl() : null,
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Espresso Dial-In',
        short_name: 'EspressoDial',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone'
      }
    })
  ].filter(Boolean)
}));
