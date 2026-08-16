const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function collectJavaScriptFiles(targetPath) {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return targetPath.endsWith(".js") ? [targetPath] : [];
  }

  return fs.readdirSync(targetPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(targetPath, entry.name);
    return entry.isDirectory() ? collectJavaScriptFiles(entryPath) : collectJavaScriptFiles(entryPath);
  });
}

const targets = [path.resolve("index.js"), path.resolve("src")];
const files = targets.flatMap(collectJavaScriptFiles);
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
