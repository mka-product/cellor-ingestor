import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/slides": "http://localhost:8000",
      "/storage": "http://localhost:8000",
      "/uploads": "http://localhost:8000",
      "/overlay-uploads": "http://localhost:8000",
      "/jobs": "http://localhost:8000",
      "/overlay-jobs": "http://localhost:8000",
      "/readers": "http://localhost:8000"
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./tests/setup.ts"
  }
});
