import { createServer } from "node:http";
import { assertServerConfig, config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { sequelize } from "./models/index.js";
import { ensureUploadsDir } from "./services/fileStorage.js";
import { startJobWorker, stopJobWorker } from "./services/jobWorker.js";
import { createApp } from "./app.js";

assertServerConfig();
await migrate();
await ensureUploadsDir();

const app = createApp();
const server = createServer(app);

startJobWorker();

server.listen(config.port, () => {
  console.log(`SMDE listening on http://localhost:${config.port}`);
});

const shutdown = async () => {
  server.close();
  stopJobWorker();
  await sequelize.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
