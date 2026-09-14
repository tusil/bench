export default defineNuxtConfig({
  compatibilityDate: "2026-09-14",
  css: ["~/assets/css/main.css"],
  devtools: { enabled: false },
  modules: ["@nuxt/ui"],
  nitro: {
    preset: "node-server",
  },
  runtimeConfig: {
    managerOrigin: "http://localhost:3000",
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
});
