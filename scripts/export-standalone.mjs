import { copyFile } from "node:fs/promises";

await copyFile(
  new URL("../dist/index.html", import.meta.url),
  new URL("../金永昊精选ETF净值.html", import.meta.url),
);
