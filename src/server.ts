import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, () => {
  logger.info({ port: config.port }, "Chowchow API listening");
});
