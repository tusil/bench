export default defineNuxtConfig({
  compatibilityDate: "2026-09-14",
  css: ["~/assets/css/main.css"],
  devtools: { enabled: false },
  modules: ["@nuxt/ui"],
  nitro: {
    preset: "node-server",
  },
  runtimeConfig: {
    sshUser: "",
    sshHost: "",
    public: {
      managerOrigin: "http://localhost:3000",
    },
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
});
