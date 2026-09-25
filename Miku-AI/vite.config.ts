import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-ignore módulos de node (no hay @types/node instalado)
import fs from "node:fs";
// @ts-ignore
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// B5: el banco de pruebas (bench.html, solo en dev) manda sus fotos acá y
// se guardan en bench-shots/, para mirarlas fuera del navegador. apply:
// "serve" -> no existe en el build.
const benchShots = {
  name: "miku-bench-shots",
  apply: "serve" as const,
  configureServer(server: any) {
    const dir = path.join(server.config.root, "bench-shots");
    server.middlewares.use("/__bench/shot/", (req: any, res: any) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        return res.end();
      }
      const name = decodeURIComponent(req.url.slice(1)).replace(/[^a-zA-Z0-9_-]/g, "_") || "shot";
      let body = "";
      req.on("data", (chunk: any) => (body += chunk));
      req.on("end", () => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${name}.jpg`), (globalThis as any).Buffer.from(body.replace(/^data:image\/\w+;base64,/, ""), "base64"));
        res.end("ok");
      });
    });
  },
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), benchShots],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
