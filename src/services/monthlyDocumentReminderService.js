const { Markup } = require("telegraf");
const {
  getMonthlyDocumentReminderSettings,
  updateMonthlyDocumentReminderSettings
} = require("./settingsService");
const { listDocumentReminderRecipients } = require("./userService");
const { monthYearLabel } = require("../utils/dateHelpers");

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

function getTodayParts() {
  const now = new Date();
  return {
    day: now.getDate(),
    isoDate: [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-")
  };
}

function getPreviousMonthParts() {
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    month: previous.getMonth() + 1,
    year: previous.getFullYear()
  };
}

async function sendReminderIfNeeded(bot, options = {}) {
  const force = Boolean(options.force);
  const settings = await getMonthlyDocumentReminderSettings();
  if (!force && !settings.day) {
    return;
  }

  const today = getTodayParts();
  if (!force && (settings.day !== today.day || settings.lastPromptDate === today.isoDate)) {
    return;
  }

  const recipients = await listDocumentReminderRecipients();
  if (!recipients.length) {
    return;
  }

  const previousMonth = getPreviousMonthParts();
  const periodLabel = monthYearLabel(previousMonth.month, previousMonth.year);
  const text = [
    `Прошёл месяц: ${periodLabel}.`,
    "Сформировать акт выполненных работ и акт сверки?",
    "",
    "Акт сверки будет сформирован с учётом этого неподписанного месяца."
  ].join("\n");
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Да, сформировать оба акта", `monthlydocs:generate:${previousMonth.year}:${previousMonth.month}`)],
    [Markup.button.callback("Не сейчас", "monthlydocs:dismiss")]
  ]);

  for (const recipient of recipients) {
    try {
      await bot.telegram.sendMessage(recipient.telegram_id, text, keyboard);
    } catch (error) {
      console.warn(
        `Не удалось отправить напоминание пользователю ${recipient.telegram_id}: ${error.message}`
      );
    }
  }

  if (!force) {
    await updateMonthlyDocumentReminderSettings({ lastPromptDate: today.isoDate });
  }
}

function startMonthlyDocumentReminder(bot) {
  const run = () => {
    sendReminderIfNeeded(bot).catch((error) => {
      console.error("Ошибка ежемесячного напоминания:", error.message);
    });
  };

  run();
  return setInterval(run, CHECK_INTERVAL_MS);
}

module.exports = {
  sendReminderIfNeeded,
  startMonthlyDocumentReminder
};
