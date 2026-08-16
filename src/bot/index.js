const https = require("https");
const { Telegraf, session } = require("telegraf");
const config = require("../config");
const { USER_ROLES } = require("../constants");
const { getMealEntryById } = require("../services/mealService");
const { resolveAccessUser } = require("../services/userService");
const { registerHandlers } = require("./railshipHandlers");

const OWNER_ONLY_CALLBACK_PREFIXES = [
  "user:",
  "employee:",
  "settings:",
  "advance:",
  "doc:advance:",
  "doc:uploadsigned:",
  "doc:sent:",
  "client:doc:uploadmonth:",
  "client:doc:uploadsigned:"
];

function isOwnerOnlyCallback(callbackData) {
  return OWNER_ONLY_CALLBACK_PREFIXES.some((prefix) => callbackData?.startsWith(prefix));
}

function isOwnerOnlyFlow(flowName) {
  return Boolean(flowName) && (
    flowName.startsWith("user:") ||
    flowName.startsWith("employee:") ||
    flowName.startsWith("settings:") ||
    flowName.startsWith("advance:") ||
    flowName === "doc:upload_signed"
  );
}

function isRailshipSelfService(user) {
  return user?.role === USER_ROLES.BARISTA && user.company === "RS" && user.receives_meals;
}

function getFlowEmployeeId(flow) {
  return Number(flow?.data?.employeeId ?? flow?.data?.employee_id ?? 0) || null;
}

async function answerDenied(ctx, message = "Недостаточно прав") {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery(message, { show_alert: true });
    return;
  }
  await ctx.reply(message);
}

async function validateSelfServiceMealCallback(ctx, accessUser, callbackData) {
  const ownEmployeeId = Number(accessUser.employee_id || 0);

  if (!ownEmployeeId) {
    if (
      callbackData === "meal:add" ||
      callbackData === "nav:meals" ||
      callbackData?.startsWith("meal:") ||
      callbackData?.startsWith("barista:selfemployee")
    ) {
      await answerDenied(ctx, "Ваш профиль питания не привязан к сотруднику. Обратитесь к администратору");
      return false;
    }
    return true;
  }

  if (callbackData === "nav:meals" || callbackData?.startsWith("meal:list")) {
    await answerDenied(ctx, "Для сотрудника Railship доступна только отметка своего питания");
    return false;
  }

  if (callbackData?.startsWith("barista:selfemployee")) {
    await answerDenied(ctx, "Привязка сотрудника задаётся администратором");
    return false;
  }

  const employeeCallback = callbackData?.match(/^meal:(?:pickemployee|add:repeat):(\d+)$/);
  if (employeeCallback && Number(employeeCallback[1]) !== ownEmployeeId) {
    await answerDenied(ctx, "Можно отметить питание только себе");
    return false;
  }

  if (callbackData?.startsWith("meal:edit:employee:")) {
    await answerDenied(ctx, "Сотрудника в своей записи менять нельзя");
    return false;
  }

  const mealCallback = callbackData?.match(/^meal:(view|edit:(?:amount|comment|date)|delete):(\d+)$/);
  if (mealCallback) {
    const meal = await getMealEntryById(Number(mealCallback[2]));
    if (!meal || Number(meal.employee_id) !== ownEmployeeId) {
      await answerDenied(ctx, "Эта запись питания вам недоступна");
      return false;
    }

    if (mealCallback[1] !== "view" && Number(meal.created_by_user_id) !== Number(accessUser.id)) {
      await answerDenied(ctx, "Изменять можно только свои записи питания");
      return false;
    }
  }

  const clientMealCallback = callbackData?.match(/^client:meal:view:(\d+):/);
  if (clientMealCallback) {
    const meal = await getMealEntryById(Number(clientMealCallback[1]));
    if (!meal || Number(meal.employee_id) !== ownEmployeeId) {
      await answerDenied(ctx, "Эта запись питания вам недоступна");
      return false;
    }
  }

  return true;
}

function createBot() {
  const agent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 10000,
    family: 4
  });

  const bot = new Telegraf(config.botToken, {
    telegram: {
      agent,
      attachmentAgent: agent
    }
  });

  bot.use(session());

  bot.use(async (ctx, next) => {
    if (!ctx.from) {
      return;
    }

    const accessUser = await resolveAccessUser(ctx.from, config.adminIds);

    if (!accessUser) {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery("Нет доступа", { show_alert: true });
        return;
      }
      await ctx.reply("Нет доступа");
      return;
    }

    ctx.state.user = accessUser;
    ctx.session = ctx.session || {};

    const callbackData = ctx.callbackQuery?.data || null;
    const isOwner = accessUser.role === USER_ROLES.OWNER;

    if (!isOwner && callbackData && isOwnerOnlyCallback(callbackData)) {
      await answerDenied(ctx);
      return;
    }

    if (!isOwner && isOwnerOnlyFlow(ctx.session.flow?.name)) {
      ctx.session.flow = null;
      if (!ctx.callbackQuery) {
        await answerDenied(ctx);
        return;
      }
    }

    if (accessUser.role === USER_ROLES.BARISTA) {
      const selfService = isRailshipSelfService(accessUser);
      ctx.session.baristaKind = selfService ? "railship" : "coffee";

      if (callbackData?.startsWith("barista:")) {
        await ctx.answerCbQuery("Режим работы назначается автоматически", {
          show_alert: true
        });
        return;
      }

      if (selfService) {
        const flow = ctx.session.flow;
        const flowEmployeeId = getFlowEmployeeId(flow);
        if (
          (flow?.name === "meal:add" || flow?.name?.startsWith("meal:edit")) &&
          flowEmployeeId &&
          flowEmployeeId !== Number(accessUser.employee_id || 0)
        ) {
          ctx.session.flow = null;
          await answerDenied(ctx, "Старая операция отменена: можно работать только со своим питанием");
          return;
        }

        const allowed = await validateSelfServiceMealCallback(ctx, accessUser, callbackData);
        if (!allowed) {
          return;
        }
      }
    }

    return next();
  });

  registerHandlers(bot);
  return bot;
}

module.exports = createBot;
