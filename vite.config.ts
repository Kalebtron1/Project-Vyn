import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const e2e = process.env.VITE_E2E === "1";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // Permite que los popups OAuth (Accesly login con Google/Apple) conserven la
    // relación con la ventana que los abre, para que el postMessage de éxito llegue
    // de vuelta. Sin esto, COOP corta el window.opener y el login no completa.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    },
    hmr: {
      overlay: false,
    },
    proxy: {
      // Proxy API requests to backend running on port 3000
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, "/api")
      }
    }
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    },
  },
  build: {
    rollupOptions: {
      output: {
        // React y el router se cargan completos en cada visita: en su propio chunk
        // siguen cacheados entre deploys aunque cambie el código de la app.
        // Privy/viem/WalletConnect NO van en un chunk manual: tienen pantallas que hoy
        // se cargan bajo demanda y forzarlas a un chunk las metería al bundle inicial.
        // El Stellar SDK ya sale solo en un chunk aparte que piden las páginas que lo usan.
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//.test(id)) {
            return "vendor-react";
          }
        },
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Playwright boots without a real Privy app id — stub the SDK.
      ...(e2e
        ? {
            "@privy-io/react-auth/extended-chains": path.resolve(
              __dirname,
              "e2e/mocks/privy-extended.ts"
            ),
            "@privy-io/react-auth": path.resolve(__dirname, "e2e/mocks/privy.tsx"),
          }
        : {}),
    },
  },
}));
