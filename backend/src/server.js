import dns from "node:dns";
import "dotenv/config";

import { connectDatabase } from "./config/db.js";
import { createApp } from "./app.js";
import { startInlineOutboxProcessor } from "./services/outboxProcessor.js";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const port = Number(process.env.PORT || 4000);

await connectDatabase();

// Free Render web services can process click classification from MongoDB directly;
// no paid background worker or ephemeral Redis queue is required for the MVP.
startInlineOutboxProcessor();

const app = createApp();

app.listen(port, () => {
  console.log(`LinkPulse API listening on http://localhost:${port}`);
});