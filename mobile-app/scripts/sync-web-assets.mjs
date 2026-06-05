import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mobileRoot = path.resolve(__dirname, "..");
const webProjectRoot = path.resolve(mobileRoot, "..", "web-app");
const webDir = path.join(mobileRoot, "www");

const filesToCopy = [
  "index.html",
  "app.js",
  "cards.js",
  "styles.css"
];

async function sync() {
  await rm(webDir, { recursive: true, force: true });
  await mkdir(webDir, { recursive: true });

  for (const fileName of filesToCopy) {
    const source = path.join(webProjectRoot, fileName);
    const destination = path.join(webDir, fileName);
    await cp(source, destination, { force: true });
  }

  await cp(path.join(webProjectRoot, "assets"), path.join(webDir, "assets"), {
    recursive: true,
    force: true
  });

  await writeFile(
    path.join(webDir, ".sync-source.json"),
    JSON.stringify(
      {
        copiedAt: new Date().toISOString(),
        sourceRoot: webProjectRoot,
        files: [...filesToCopy, "assets/"]
      },
      null,
      2
    )
  );

  console.log(`Synced web assets into ${webDir}`);
}

sync().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
