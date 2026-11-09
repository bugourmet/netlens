import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Defense in depth for a page that shows names taken from network traffic: even if one
// slipped past escaping, it couldn't run script or load anything from elsewhere.
// Only in builds; the dev server needs inline scripts for hot reload.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // animation libraries set inline styles
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const contentSecurityPolicy = (): Plugin => ({
  name: 'netlens-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  base: './', // the .NET shell serves the files from a virtual host
  plugins: [react(), contentSecurityPolicy()],
  server: { port: 5183, strictPort: true },
});
