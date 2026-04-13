const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function parseAdminIds(raw) {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item));
}

const generatedDir = path.resolve(process.cwd(), "generated");

const config = {
  botToken: process.env.BOT_TOKEN || "",
  adminIds: parseAdminIds(process.env.ADMIN_IDS),
  databaseUrl: process.env.DATABASE_URL || "",
  dbHost: process.env.DB_HOST || "localhost",
  dbPort: Number(process.env.DB_PORT || 5432),
  dbName: process.env.DB_NAME || "corp_settlements_bot",
  dbUser: process.env.DB_USER || "postgres",
  dbPassword: process.env.DB_PASSWORD || "postgres",
  generatedDir,
  documentsDir: path.join(generatedDir, "documents"),
  signedDocumentsDir: path.join(generatedDir, "signed"),
  performerName: "Исполнитель"
};

module.exports = config;
