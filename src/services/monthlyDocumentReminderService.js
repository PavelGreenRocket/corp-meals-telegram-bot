const { Markup } = require("telegraf");
const {
  getMonthlyDocumentReminderSettings,
  updateMonthlyDocumentReminderSettings
} = require("./settingsService");
const { listDocumentReminderRecipients } = require("./userService");
const { getCurrentDateParts, getPreviousMonthParts, monthYearLabel } = require("../utils/dateHelpers");

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

async function sendReminderIfNeeded(bot, options = {}) {
  const force = Boolean(options.force);
  const settings = await getMonthlyDocumentReminderSettings();
  if (!force && !settings.day) {
    return;
  }

  const today = getCurrentDateParts();
  const previousMonth = getPreviousMonthParts();
  const promptPeriod = `${previousMonth.year}-${String(previousMonth.month).padStart(2, "0")}`;
  const promptedThisMonth = settings.lastPromptDate
    && String(settings.lastPromptDate).slice(0, 7) === today.isoDate.slice(0, 7);
  const alreadyPrompted = settings.lastPromptPeriod === promptPeriod
    || (!settings.lastPromptPeriod && promptedThisMonth);
  if (!force && (today.day < settings.day || alreadyPrompted)) {
    return;
  }

  const recipients = await listDocumentReminderRecipients();
  if (!recipients.length) {
    return;
  }

  const periodLabel = monthYearLabel(previousMonth.month, previousMonth.year);
  const text = [
    `Прошёл месяц: ${periodLabel}.`,
    "Перед формированием документов проверим, что данные о питании за месяц заполнены и подтверждены."
  ].join("\n");
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Проверить данные и документы", `monthlydocs:review:${previousMonth.year}:${previousMonth.month}`)],
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
    await updateMonthlyDocumentReminderSettings({
      lastPromptDate: today.isoDate,
      lastPromptPeriod: promptPeriod
    });
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
