const https = require("https");
const { Telegraf, session } = require("telegraf");
const config = require("../config");
const { USER_ROLES } = require("../constants");
const { resolveAccessUser } = require("../services/userService");
const { registerHandlers } = require("./railshipHandlers");

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

    if (accessUser.role === USER_ROLES.BARISTA) {
      ctx.session = ctx.session || {};
      const isRailshipSelfService = accessUser.company === "RS" && accessUser.receives_meals;
      ctx.session.baristaKind = isRailshipSelfService ? "railship" : "coffee";

      const callbackData = ctx.callbackQuery?.data;
      if (callbackData === "barista:mode" || callbackData?.startsWith("barista:kind:")) {
        await ctx.answerCbQuery("Режим работы назначается автоматически", {
          show_alert: true
        });
        return;
      }
    }

    return next();
  });

  registerHandlers(bot);
  return bot;
}

module.exports = createBot;
