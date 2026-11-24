import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

function removeStandaloneRedirect() {
  return {
    name: "remove-standalone-redirect",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(/<script id="standalone-redirect">[\s\S]*?<\/script>/, "");
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [removeStandaloneRedirect(), viteSingleFile()],
  server: {
    port: 4173,
  },
  preview: {
    port: 4173,
  },
});
