import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SITE_URL = "https://animal-race-party.netlify.app/";
const OUTPUT_DIR = path.resolve("recovered-site");
const PRETTY_DIR = path.join(OUTPUT_DIR, "_pretty");

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

function extractAssetPaths(text) {
  const matches = text.match(/\/assets\/[^"'`) \n\r]+/g) ?? [];
  return [...new Set(matches)];
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function saveText(relativePath, content) {
  const filePath = path.join(OUTPUT_DIR, relativePath);
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, "utf8");
}

async function saveBuffer(relativePath, content) {
  const filePath = path.join(OUTPUT_DIR, relativePath);
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content);
}

function relativeAssetPath(assetPath) {
  return assetPath.replace(/^\//, "");
}

async function main() {
  await ensureDir(OUTPUT_DIR);
  await ensureDir(PRETTY_DIR);

  const html = await fetchText(SITE_URL);
  await saveText("index.html", html);

  const scriptMatch = html.match(/<script[^>]+src="([^"]+)"/i);
  const styleMatch = html.match(/<link[^>]+href="([^"]+\.css)"/i);

  if (!scriptMatch || !styleMatch) {
    throw new Error("Could not find the main JavaScript or CSS bundle in the HTML.");
  }

  const jsPath = scriptMatch[1];
  const cssPath = styleMatch[1];
  const jsUrl = new URL(jsPath, SITE_URL).href;
  const cssUrl = new URL(cssPath, SITE_URL).href;

  const [js, css] = await Promise.all([fetchText(jsUrl), fetchText(cssUrl)]);
  await saveText(relativeAssetPath(jsPath), js);
  await saveText(relativeAssetPath(cssPath), css);
  await saveText(path.join("_pretty", "index.bundle.js"), js);
  await saveText(path.join("_pretty", "index.bundle.css"), css);

  const assetPaths = [...new Set([...extractAssetPaths(js), ...extractAssetPaths(css)])];

  for (const assetPath of assetPaths) {
    const assetUrl = new URL(assetPath, SITE_URL).href;
    const assetBuffer = await fetchBuffer(assetUrl);
    await saveBuffer(relativeAssetPath(assetPath), assetBuffer);
  }

  const manifest = {
    siteUrl: SITE_URL,
    generatedAt: new Date().toISOString(),
    html: "index.html",
    jsBundle: relativeAssetPath(jsPath),
    cssBundle: relativeAssetPath(cssPath),
    assets: assetPaths.map(relativeAssetPath)
  };

  await saveText("recovery-manifest.json", JSON.stringify(manifest, null, 2));

  console.log(`Recovered ${assetPaths.length} assets into ${OUTPUT_DIR}`);
  console.log(`Main bundle: ${manifest.jsBundle}`);
  console.log(`Stylesheet: ${manifest.cssBundle}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
