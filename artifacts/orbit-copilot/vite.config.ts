import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT ?? "5173";
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Vercel / production static hosting uses root base path by default.
const basePath = process.env.BASE_PATH ?? "/";

/** Preload primary Inter woff2 so optional fonts land before first paint when possible. */
function injectFontPreload() {
  return {
    name: "inject-font-preload",
    apply: "build" as const,
    transformIndexHtml: {
      order: "post" as const,
      handler(html: string, ctx: { bundle?: Record<string, { type: string; fileName?: string }> }) {
        if (!ctx.bundle) return html;
        const font = Object.values(ctx.bundle).find(
          (asset) =>
            asset.type === "asset" &&
            asset.fileName?.includes("inter-latin-400-normal") &&
            asset.fileName.endsWith(".woff2")
        );
        if (!font?.fileName) return html;
        const prefix = basePath.endsWith("/") ? basePath : `${basePath}/`;
        const tag = `<link rel="preload" href="${prefix}assets/${font.fileName}" as="font" type="font/woff2" crossorigin>`;
        return html.replace("</head>", `${tag}\n </head>`);
      },
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    injectFontPreload(),
    ...(process.env.NODE_ENV !== "production" ? [runtimeErrorOverlay()] : []),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    target: "es2020",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@stellar/stellar-sdk")) return "stellar-sdk";
          if (
            id.includes("react-markdown") ||
            id.includes("remark") ||
            id.includes("micromark")
          ) {
            return "markdown";
          }
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("@tanstack")) return "query";
          if (id.includes("jszip")) return "jszip";
          if (
            id.includes("react-dom") ||
            id.includes("/react/") ||
            id.includes("scheduler")
          ) {
            return "react-vendor";
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
