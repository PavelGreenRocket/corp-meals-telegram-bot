const fs = require("fs");
const config = require("./config");
const pool = require("./db/pool");
const createBot = require("./bot");
const { startMonthlyDocumentReminder } = require("./services/monthlyDocumentReminderService");
const { ensureBootstrapOwners } = require("./services/userService");

async function start() {
  if (!config.botToken) {
    throw new Error("BOT_TOKEN не задан. Заполните .env");
  }

  await pool.query("SELECT 1");

  [config.generatedDir, config.documentsDir, config.signedDocumentsDir].forEach((dirPath) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });

  await ensureBootstrapOwners(config.adminIds);

  const bot = createBot();

  await bot.launch();
  const monthlyDocumentReminder = startMonthlyDocumentReminder(bot);
  console.log("Бот запущен");

  const shutdown = async (signal) => {
    console.log(`Получен сигнал ${signal}, завершаем работу...`);
    clearInterval(monthlyDocumentReminder);
    bot.stop(signal);
    await pool.end();
    process.exit(0);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error) => {
  console.error("Ошибка запуска:", error.message);
  process.exit(1);
});
