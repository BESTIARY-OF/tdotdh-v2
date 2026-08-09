import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const productDirectory = resolve(testDirectory, "..", "product");
const productFiles = ["index.html", "styles.css", "app.js", "v2-runtime.js", "search-worker.js"];

async function assertRegularFile(relativePath) {
  const filePath = resolve(productDirectory, relativePath);
  const fileStats = await stat(filePath);
  assert.equal(fileStats.isFile(), true, `expected published product file: ${relativePath}`);
}

for (const relativePath of productFiles) await assertRegularFile(relativePath);

const index = await readFile(resolve(productDirectory, "index.html"), "utf8");
const productApp = await readFile(resolve(productDirectory, "app.js"), "utf8");
const absoluteProductAssets = [
  /href="(\/apps\/field-guide\/product\/styles\.css(?:\?[^\"]*)?)"/,
  /src="(\/apps\/field-guide\/product\/v2-runtime\.js(?:\?[^\"]*)?)"/,
  /src="(\/apps\/field-guide\/product\/app\.js(?:\?[^\"]*)?)"/
];

for (const assetPattern of absoluteProductAssets) {
  const match = index.match(assetPattern);
  assert.ok(match, `index must reference an absolute product asset: ${assetPattern}`);
  assert.equal(match[1].startsWith("/apps/field-guide/product/"), true);
}

const workerPath = "/apps/field-guide/product/search-worker.js";
assert.match(productApp, /new Worker\('\/apps\/field-guide\/product\/search-worker\.js(?:\?[^']*)?'\)/);

console.log(JSON.stringify({
  productFiles: productFiles.length,
  absoluteAssetReferences: absoluteProductAssets.length,
  workerPath,
  result: "passed"
}));
