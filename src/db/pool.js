const { Pool } = require("pg");
const config = require("../config");

const poolConfig = config.databaseUrl
  ? {
      connectionString: config.databaseUrl
    }
  : {
      host: config.dbHost,
      port: config.dbPort,
      database: config.dbName,
      user: config.dbUser,
      password: config.dbPassword
    };

const pool = new Pool(poolConfig);

pool.on("error", (error) => {
  console.error("Ошибка PostgreSQL pool:", error);
});

module.exports = pool;
