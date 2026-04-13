const fs = require("fs/promises");
const dayjs = require("dayjs");
const { Input } = require("telegraf");
const {
  MAIN_MENU,
  clientsSectionKeyboard,
  clientsListKeyboard,
  clientSelectionKeyboard
} = require("./keyboards");
const {
  listClients,
  getClientById,
  createClient,
  getClientCard
} = require("../services/clientService");
const {
  createOperation,
  listClientOperations,
  calculateClientBalance
} = require("../services/operationService");
const { generateMonthlyAct } = require("../services/actService");
const {
  generateReconciliationReport
} = require("../services/reconciliationService");
const { generateMonthlyRegistry } = require("../services/registryService");
const { parseDateInput, normalizeMonthYearInput, formatDateRu } = require("../utils/dates");
const { parseAmount, formatAmount } = require("../utils/money");
const { formatOperationLine } = require("../utils/formatters");

const MENU = {
  CLIENTS: "Клиенты",
  ADD_ADVANCE: "Добавить аванс",
  ADD_MEAL: "Добавить питание",
  BALANCE: "Остаток аванса",
  HISTORY: "История операций",
  ACT: "Сформировать акт",
  RECONCILIATION: "Сформировать акт сверки",
  REGISTRY: "Сформировать реестр",
  CANCEL: "Отмена"
};

function ensureSession(ctx) {
  if (!ctx.session) {
    ctx.session = {};
  }
  if (!ctx.session.flow) {
    ctx.session.flow = null;
  }
}

function setFlow(ctx, name, step, data = {}) {
  ensureSession(ctx);
  ctx.session.flow = { name, step, data };
}

function clearFlow(ctx) {
  ensureSession(ctx);
  ctx.session.flow = null;
}

function currentFlow(ctx) {
  ensureSession(ctx);
  return ctx.session.flow;
}

async function sendMainMenu(ctx, message = "Выберите действие:") {
  await ctx.reply(message, MAIN_MENU);
}

async function promptClientSelection(ctx, action, title = "Выберите клиента:") {
  const clients = await listClients(true);
  if (!clients.length) {
    await ctx.reply("Нет активных клиентов. Сначала добавьте клиента.", MAIN_MENU);
    return false;
  }
  await ctx.reply(title, clientSelectionKeyboard(clients, action));
  return true;
}

function normalizeOptionalText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed || trimmed === "-") {
    return null;
  }
  return trimmed;
}

async function tryDeleteFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Файл может уже быть удален.
  }
}

async function sendGeneratedFile(ctx, filePath, caption) {
  await ctx.replyWithDocument(Input.fromLocalFile(filePath), { caption });
  await tryDeleteFile(filePath);
}

async function showClientCardById(ctx, clientId) {
  const card = await getClientCard(clientId);
  if (!card) {
    await ctx.reply("Клиент не найден.");
    return;
  }

  await ctx.reply(
    [
      `Клиент: ${card.short_name}`,
      `Юр. лицо: ${card.legal_name}`,
      `ИНН: ${card.inn}`,
      `КПП: ${card.kpp || "-"}`,
      `Всего оплат: ${formatAmount(card.totalPaid)} ₽`,
      `Всего начислено: ${formatAmount(card.totalCharged)} ₽`,
      `Остаток: ${formatAmount(card.balance)} ₽`
    ].join("\n")
  );
}

async function showClientBalance(ctx, clientId) {
  const client = await getClientById(clientId);
  if (!client) {
    await ctx.reply("Клиент не найден.");
    return;
  }

  const balanceData = await calculateClientBalance(clientId);
  await ctx.reply(
    [
      `Клиент: ${client.short_name}`,
      `Всего оплат (advance): ${formatAmount(balanceData.totalPaid)} ₽`,
      `Всего начислено (meal): ${formatAmount(balanceData.totalCharged)} ₽`,
      `Текущий остаток аванса: ${formatAmount(balanceData.balance)} ₽`
    ].join("\n")
  );
}

async function showClientHistory(ctx, clientId, limit = 20) {
  const client = await getClientById(clientId);
  if (!client) {
    await ctx.reply("Клиент не найден.");
    return;
  }

  const operations = await listClientOperations(clientId, limit);
  if (!operations.length) {
    await ctx.reply(`У клиента ${client.short_name} пока нет операций.`);
    return;
  }

  const lines = operations.map((operation, index) => {
    return `${index + 1}. ${formatOperationLine(operation)}`;
  });

  await ctx.reply(
    [`Последние ${operations.length} операций по клиенту ${client.short_name}:`, ...lines].join(
      "\n"
    )
  );
}

function parsePeriodInput(text) {
  const raw = String(text || "").trim();
  const lowered = raw.toLowerCase();

  if (!raw || raw === "-" || lowered === "вся история" || lowered === "история") {
    return {
      mode: "full_history",
      startDate: null,
      endDate: dayjs().format("YYYY-MM-DD")
    };
  }

  const parts = raw.split(/\s-\s/);
  if (parts.length !== 2) {
    return null;
  }

  const startDate = parseDateInput(parts[0]);
  const endDate = parseDateInput(parts[1]);

  if (!startDate || !endDate) {
    return null;
  }

  if (dayjs(startDate).isAfter(dayjs(endDate))) {
    return null;
  }

  return {
    mode: "period",
    startDate,
    endDate
  };
}

async function handleFlowInput(ctx, text) {
  const flow = currentFlow(ctx);
  if (!flow) {
    await sendMainMenu(ctx);
    return;
  }

  if (flow.name === "add_client") {
    if (flow.step === "short_name") {
      if (text.length < 2) {
        await ctx.reply("Короткое имя слишком короткое. Введите еще раз:");
        return;
      }
      flow.data.shortName = text;
      flow.step = "legal_name";
      await ctx.reply("Введите полное юридическое название клиента:");
      return;
    }

    if (flow.step === "legal_name") {
      if (text.length < 3) {
        await ctx.reply("Название слишком короткое. Введите еще раз:");
        return;
      }
      flow.data.legalName = text;
      flow.step = "inn";
      await ctx.reply("Введите ИНН (10 или 12 цифр):");
      return;
    }

    if (flow.step === "inn") {
      const inn = text.replace(/\D/g, "");
      if (!(inn.length === 10 || inn.length === 12)) {
        await ctx.reply("Некорректный ИНН. Введите 10 или 12 цифр:");
        return;
      }
      flow.data.inn = inn;
      flow.step = "kpp";
      await ctx.reply("Введите КПП (9 цифр) или '-' если нет:");
      return;
    }

    if (flow.step === "kpp") {
      const kpp = normalizeOptionalText(text);
      if (kpp && !/^\d{9}$/.test(kpp)) {
        await ctx.reply("КПП должен содержать 9 цифр. Введите еще раз или '-'");
        return;
      }

      const created = await createClient({
        shortName: flow.data.shortName,
        legalName: flow.data.legalName,
        inn: flow.data.inn,
        kpp
      });

      clearFlow(ctx);
      await ctx.reply(`Клиент "${created.short_name}" успешно добавлен.`);
      await sendMainMenu(ctx);
      return;
    }
  }

  if (flow.name === "add_advance") {
    if (flow.step === "date") {
      const parsedDate = parseDateInput(text);
      if (!parsedDate) {
        await ctx.reply("Неверный формат даты. Используйте ДД.ММ.ГГГГ или YYYY-MM-DD:");
        return;
      }
      flow.data.operationDate = parsedDate;
      flow.step = "amount";
      await ctx.reply("Введите сумму аванса:");
      return;
    }

    if (flow.step === "amount") {
      const amount = parseAmount(text);
      if (!amount) {
        await ctx.reply("Неверная сумма. Введите положительное число:");
        return;
      }
      flow.data.amount = amount;
      flow.step = "comment";
      await ctx.reply("Введите комментарий или '-' чтобы пропустить:");
      return;
    }

    if (flow.step === "comment") {
      const operation = await createOperation({
        clientId: flow.data.clientId,
        operationType: "advance",
        operationDate: flow.data.operationDate,
        amount: flow.data.amount,
        comment: normalizeOptionalText(text)
      });
      clearFlow(ctx);
      await ctx.reply(
        `Аванс сохранен: ${formatDateRu(operation.operation_date)}, ${formatAmount(
          operation.amount
        )} ₽`
      );
      await sendMainMenu(ctx);
      return;
    }
  }

  if (flow.name === "add_meal") {
    if (flow.step === "date") {
      const parsedDate = parseDateInput(text);
      if (!parsedDate) {
        await ctx.reply("Неверный формат даты. Используйте ДД.ММ.ГГГГ или YYYY-MM-DD:");
        return;
      }
      flow.data.operationDate = parsedDate;
      flow.step = "amount";
      await ctx.reply("Введите сумму питания:");
      return;
    }

    if (flow.step === "amount") {
      const amount = parseAmount(text);
      if (!amount) {
        await ctx.reply("Неверная сумма. Введите положительное число:");
        return;
      }
      flow.data.amount = amount;
      flow.step = "persons_count";
      await ctx.reply("Введите количество питающихся или '-' чтобы пропустить:");
      return;
    }

    if (flow.step === "persons_count") {
      const optional = normalizeOptionalText(text);
      if (optional) {
        const personsCount = Number(optional);
        if (!Number.isInteger(personsCount) || personsCount <= 0) {
          await ctx.reply("Введите целое число больше 0 или '-'");
          return;
        }
        flow.data.personsCount = personsCount;
      } else {
        flow.data.personsCount = null;
      }
      flow.step = "comment";
      await ctx.reply("Введите комментарий или '-' чтобы пропустить:");
      return;
    }

    if (flow.step === "comment") {
      const operation = await createOperation({
        clientId: flow.data.clientId,
        operationType: "meal",
        operationDate: flow.data.operationDate,
        amount: flow.data.amount,
        personsCount: flow.data.personsCount,
        comment: normalizeOptionalText(text)
      });
      clearFlow(ctx);
      await ctx.reply(
        `Питание сохранено: ${formatDateRu(operation.operation_date)}, ${formatAmount(
          operation.amount
        )} ₽`
      );
      await sendMainMenu(ctx);
      return;
    }
  }

  if (flow.name === "generate_act" && flow.step === "month_year") {
    const monthYear = normalizeMonthYearInput(text);
    if (!monthYear) {
      await ctx.reply("Введите месяц и год в формате ММ.ГГГГ, например 02.2026:");
      return;
    }

    const report = await generateMonthlyAct({
      clientId: flow.data.clientId,
      month: monthYear.month,
      year: monthYear.year
    });

    clearFlow(ctx);
    await sendGeneratedFile(
      ctx,
      report.filePath,
      `Акт №${report.actNumber} за ${String(monthYear.month).padStart(2, "0")}.${monthYear.year}\n` +
        `Сумма: ${formatAmount(report.summary.totalAmount)} ₽, дней: ${report.summary.daysCount}`
    );
    await sendMainMenu(ctx);
    return;
  }

  if (flow.name === "generate_registry" && flow.step === "month_year") {
    const monthYear = normalizeMonthYearInput(text);
    if (!monthYear) {
      await ctx.reply("Введите месяц и год в формате ММ.ГГГГ, например 02.2026:");
      return;
    }

    const report = await generateMonthlyRegistry({
      clientId: flow.data.clientId,
      month: monthYear.month,
      year: monthYear.year
    });

    clearFlow(ctx);
    await sendGeneratedFile(
      ctx,
      report.filePath,
      `Реестр за ${String(monthYear.month).padStart(2, "0")}.${monthYear.year}\n` +
        `Сумма: ${formatAmount(report.summary.totalAmount)} ₽, дней: ${report.summary.daysCount}`
    );
    await sendMainMenu(ctx);
    return;
  }

  if (flow.name === "generate_reconciliation" && flow.step === "period") {
    const period = parsePeriodInput(text);
    if (!period) {
      await ctx.reply(
        "Введите 'вся история' или период в формате ДД.ММ.ГГГГ - ДД.ММ.ГГГГ"
      );
      return;
    }

    const report = await generateReconciliationReport({
      clientId: flow.data.clientId,
      mode: period.mode,
      startDate: period.startDate,
      endDate: period.endDate
    });

    clearFlow(ctx);
    await sendGeneratedFile(
      ctx,
      report.filePath,
      `Акт сверки: ${formatDateRu(report.periodStart)} - ${formatDateRu(report.periodEnd)}\n` +
        `Сальдо на конец: ${formatAmount(report.closingBalance)} ₽`
    );
    await sendMainMenu(ctx);
    return;
  }

  await sendMainMenu(ctx);
}

function withError(handler) {
  return async (ctx, ...args) => {
    try {
      await handler(ctx, ...args);
    } catch (error) {
      console.error("Ошибка обработчика:", error);
      await ctx.reply("Произошла ошибка. Проверьте данные и попробуйте снова.");
      clearFlow(ctx);
      await sendMainMenu(ctx);
    }
  };
}

function registerHandlers(bot) {
  bot.use((ctx, next) => {
    ensureSession(ctx);
    return next();
  });

  bot.start(
    withError(async (ctx) => {
      clearFlow(ctx);
      await sendMainMenu(
        ctx,
        "Привет. Я бот учета корпоративного питания.\nВыберите действие в меню:"
      );
    })
  );

  bot.command(
    "menu",
    withError(async (ctx) => {
      clearFlow(ctx);
      await sendMainMenu(ctx);
    })
  );

  bot.command(
    "cancel",
    withError(async (ctx) => {
      clearFlow(ctx);
      await sendMainMenu(ctx, "Текущий сценарий отменен.");
    })
  );

  bot.hears(
    MENU.CANCEL,
    withError(async (ctx) => {
      clearFlow(ctx);
      await sendMainMenu(ctx, "Текущий сценарий отменен.");
    })
  );

  bot.hears(
    MENU.CLIENTS,
    withError(async (ctx) => {
      clearFlow(ctx);
      await ctx.reply('Раздел "Клиенты":', clientsSectionKeyboard());
    })
  );

  bot.hears(
    MENU.ADD_ADVANCE,
    withError(async (ctx) => {
      clearFlow(ctx);
      await promptClientSelection(ctx, "add_advance", "Выберите клиента для добавления аванса:");
    })
  );

  bot.hears(
    MENU.ADD_MEAL,
    withError(async (ctx) => {
      clearFlow(ctx);
      await promptClientSelection(ctx, "add_meal", "Выберите клиента для добавления питания:");
    })
  );

  bot.hears(
    MENU.BALANCE,
    withError(async (ctx) => {
      clearFlow(ctx);
      await promptClientSelection(ctx, "balance", "Выберите клиента для просмотра остатка:");
    })
  );

  bot.hears(
    MENU.HISTORY,
    withError(async (ctx) => {
      clearFlow(ctx);
      await promptClientSelection(ctx, "history", "Выберите клиента для просмотра истории:");
    })
  );

  bot.hears(
    MENU.ACT,
    withError(async (ctx) => {
      clearFlow(ctx);
      await promptClientSelection(ctx, "act", "Выберите клиента для формирования акта:");
    })
  );

  bot.hears(
    MENU.RECONCILIATION,
    withError(async (ctx) => {
      clearFlow(ctx);
      await promptClientSelection(
        ctx,
        "reconciliation",
        "Выберите клиента для формирования акта сверки:"
      );
    })
  );

  bot.hears(
    MENU.REGISTRY,
    withError(async (ctx) => {
      clearFlow(ctx);
      await promptClientSelection(ctx, "registry", "Выберите клиента для формирования реестра:");
    })
  );

  bot.action(
    "flow:cancel",
    withError(async (ctx) => {
      await ctx.answerCbQuery();
      clearFlow(ctx);
      await sendMainMenu(ctx, "Сценарий отменен.");
    })
  );

  bot.action(
    "clients:list",
    withError(async (ctx) => {
      await ctx.answerCbQuery();
      const clients = await listClients(false);
      if (!clients.length) {
        await ctx.reply("Клиентов пока нет.");
        return;
      }
      await ctx.reply("Список клиентов:", clientsListKeyboard(clients));
    })
  );

  bot.action(
    "clients:add",
    withError(async (ctx) => {
      await ctx.answerCbQuery();
      setFlow(ctx, "add_client", "short_name", {});
      await ctx.reply("Введите короткое имя клиента (например: Рейлшип):");
    })
  );

  bot.action(
    /client:card:(\d+)/,
    withError(async (ctx) => {
      await ctx.answerCbQuery();
      const clientId = Number(ctx.match[1]);
      await showClientCardById(ctx, clientId);
    })
  );

  bot.action(
    /select_client:([a-z_]+):(\d+)/,
    withError(async (ctx) => {
      await ctx.answerCbQuery();
      const action = ctx.match[1];
      const clientId = Number(ctx.match[2]);
      const client = await getClientById(clientId);

      if (!client) {
        await ctx.reply("Клиент не найден.");
        return;
      }

      if (action === "add_advance") {
        setFlow(ctx, "add_advance", "date", { clientId });
        await ctx.reply(
          `Клиент: ${client.short_name}\nВведите дату аванса (ДД.ММ.ГГГГ или YYYY-MM-DD):`
        );
        return;
      }

      if (action === "add_meal") {
        setFlow(ctx, "add_meal", "date", { clientId });
        await ctx.reply(
          `Клиент: ${client.short_name}\nВведите дату питания (ДД.ММ.ГГГГ или YYYY-MM-DD):`
        );
        return;
      }

      if (action === "balance") {
        clearFlow(ctx);
        await showClientBalance(ctx, clientId);
        return;
      }

      if (action === "history") {
        clearFlow(ctx);
        await showClientHistory(ctx, clientId, 20);
        return;
      }

      if (action === "act") {
        setFlow(ctx, "generate_act", "month_year", { clientId });
        await ctx.reply(
          `Клиент: ${client.short_name}\nВведите месяц и год акта в формате ММ.ГГГГ:`
        );
        return;
      }

      if (action === "reconciliation") {
        setFlow(ctx, "generate_reconciliation", "period", { clientId });
        await ctx.reply(
          `Клиент: ${client.short_name}\nВведите период в формате ДД.ММ.ГГГГ - ДД.ММ.ГГГГ или "вся история":`
        );
        return;
      }

      if (action === "registry") {
        setFlow(ctx, "generate_registry", "month_year", { clientId });
        await ctx.reply(
          `Клиент: ${client.short_name}\nВведите месяц и год реестра в формате ММ.ГГГГ:`
        );
      }
    })
  );

  bot.on(
    "text",
    withError(async (ctx) => {
      const text = String(ctx.message.text || "").trim();
      const flow = currentFlow(ctx);

      if (!flow) {
        await sendMainMenu(ctx, "Используйте кнопки меню для выбора действия.");
        return;
      }

      await handleFlowInput(ctx, text);
    })
  );
}

module.exports = {
  registerHandlers
};
