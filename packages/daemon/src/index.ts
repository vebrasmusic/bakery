#!/usr/bin/env node
import { createDaemon } from "./server.js";

createDaemon().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Bakery daemon failed to start: ${message}\n`);
  process.exit(1);
});
