const http = require("http");

function startHealthServer({ port, pool }) {
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ status: "not_found" }));
      return;
    }

    try {
      await pool.query("SELECT 1");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        status: "ok",
        service: "corp-meals-telegram-bot"
      }));
    } catch (error) {
      res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        status: "error",
        service: "corp-meals-telegram-bot"
      }));
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Health endpoint запущен на порту ${port}`);
  });

  return server;
}

function closeHealthServer(server) {
  if (!server) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

module.exports = {
  startHealthServer,
  closeHealthServer
};
