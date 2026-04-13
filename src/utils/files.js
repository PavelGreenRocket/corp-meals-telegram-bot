const fs = require("fs");
const path = require("path");
const https = require("https");

const TELEGRAM_DOWNLOAD_TIMEOUT_MS = 30000;
const TELEGRAM_DOWNLOAD_RETRIES = 3;
const downloadAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  family: 4
});

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

function sanitizeFileName(text) {
  return String(text)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_");
}

function buildFilePath(baseDir, fileName) {
  return path.join(baseDir, sanitizeFileName(fileName));
}

function unlinkIfExists(targetPath) {
  return fs.promises.unlink(targetPath).catch(() => undefined);
}

function downloadFile(url, targetPath, attempt = 1) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { agent: downloadAgent, family: 4 }, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        downloadFile(response.headers.location, targetPath, attempt).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Не удалось скачать файл, код ${response.statusCode}`));
        return;
      }

      const stream = fs.createWriteStream(targetPath);
      response.pipe(stream);
      stream.on("finish", () => {
        stream.close(() => resolve(targetPath));
      });
      stream.on("error", async (error) => {
        response.resume();
        await unlinkIfExists(targetPath);
        reject(error);
      });
    });

    request.setTimeout(TELEGRAM_DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error(`Таймаут скачивания файла (${TELEGRAM_DOWNLOAD_TIMEOUT_MS} мс)`));
    });

    request.on("error", async (error) => {
      await unlinkIfExists(targetPath);

      if (attempt < TELEGRAM_DOWNLOAD_RETRIES) {
        setTimeout(() => {
          downloadFile(url, targetPath, attempt + 1).then(resolve).catch(reject);
        }, attempt * 1000);
        return;
      }

      reject(error);
    });
  });
}

module.exports = {
  buildFilePath,
  downloadFile,
  ensureDir,
  sanitizeFileName
};
