import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import os from 'os';
import path from 'path';

const EDGE_TOKEN_PATH = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'com.agenthub.desktop',
  'edge-auth-token',
);

function readEdgeTokenFile(): string {
  try {
    const stat = fs.statSync(EDGE_TOKEN_PATH);
    if (stat.size > 4096) {
      console.warn(
        `Edge auth token file at ${EDGE_TOKEN_PATH} is ${stat.size} bytes (max 4096). ` +
        'Refusing to read oversized file — possible misconfiguration or log dump.',
      );
      return '';
    }
    return fs.readFileSync(EDGE_TOKEN_PATH, 'utf-8').trim();
  } catch {
    return '';
  }
}

/**
 * Dev-only Edge token plumbing:
 *
 * 1. **Define** (`VITE_EDGE_AUTH_TOKEN`) — seeds the initial token so the
 *    first API call succeeds.
 *
 * 2. **Dev server middleware** (`GET /__edge_token`) — returns the *current*
 *    token from the file on every request, so the frontend can refresh after
 *    Desktop restarts Edge with a new token without needing a Vite restart.
 *
 * The per-machine token must never be compiled into a distributable bundle;
 * packaged builds obtain it at runtime through the Tauri host API.
 */
function edgeAuthTokenPlugin(): Plugin {
  return {
    name: 'edge-auth-token',
    apply: 'serve',
    config() {
      return {
        define: {
          'import.meta.env.VITE_EDGE_AUTH_TOKEN': JSON.stringify(readEdgeTokenFile()),
        },
      };
    },
    configureServer(server) {
      server.middlewares.use('/__edge_token', (_req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        res.end(readEdgeTokenFile());
      });
    },
  };
}

function devCspPlugin(): Plugin {
  return {
    name: 'agenthub-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
    },
  };
}

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8')) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [react(), tailwindcss(), edgeAuthTokenPlugin(), devCspPlugin()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '..', 'shared', 'src'),
      'lucide-react': path.resolve(__dirname, 'node_modules', 'lucide-react'),
      'react': path.resolve(__dirname, 'node_modules', 'react'),
      'react-dom': path.resolve(__dirname, 'node_modules', 'react-dom'),
      'react-i18next': path.resolve(__dirname, 'node_modules', 'react-i18next'),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    headers: {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        // Embedded Edge sends back inline images as data: URIs for content previews.
        // avatars.githubusercontent.com covers GitHub avatar proxying.
        "img-src 'self' data: blob: https://avatars.githubusercontent.com https://img.example.invalid",
        // Connect covers: Edge localhost API, Hub API + WS, Desktop OIDC redirect.
        "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:* https://hub.example.invalid wss://hub.example.invalid",
        // BrowserPreview embeds user/deploy URLs; mirror index.html/tauri.conf.
        "frame-src 'self' http://127.0.0.1:* http://localhost:* https:",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "base-uri 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-tanstack': ['@tanstack/react-query'],
          'vendor-markdown': ['react-markdown', 'remark-gfm', 'react-syntax-highlighter'],
          'vendor-ui': ['lucide-react'],
          'vendor-i18n': ['i18next', 'react-i18next'],
        },
      },
    },
  },
});
