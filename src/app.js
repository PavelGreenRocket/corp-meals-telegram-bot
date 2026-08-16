const fs = require("fs");
const config = require("./config");
const pool = require("./db/pool");
const createBot = require("./bot");
const { startMonthlyDocumentReminder } = require("./services/monthlyDocumentReminderService");
const { ensureBootstrapOwners } = require("./services/userService");
const { startHealthServer, closeHealthServer } = require("./healthServer");

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
  let monthlyDocumentReminder = null;
  let healthServer = null;
  let shuttingDown = false;

  const launchPromise = bot.launch(() => {
    monthlyDocumentReminder = startMonthlyDocumentReminder(bot);
    healthServer = startHealthServer({ port: config.healthPort, pool });
    console.log("Бот запущен");
  });

  launchPromise.catch((error) => {
    if (shuttingDown) {
      return;
    }

    console.error("Ошибка Telegram polling:", error.message);
    process.exit(1);
  });

  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`Получен сигнал ${signal}, завершаем работу...`);

    if (monthlyDocumentReminder) {
      clearInterval(monthlyDocumentReminder);
    }

    try {
      bot.stop(signal);
    } catch (error) {
      console.warn("Telegram bot ещё не был полностью запущен:", error.message);
    }

    await closeHealthServer(healthServer);
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
