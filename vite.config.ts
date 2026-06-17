import { defineConfig } from "vite";

export default defineConfig({
  // Относительные пути к ассетам — работает на GitHub Pages в подпапке /<repo>/.
  base: "./",
  server: {
    host: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
});
