import { createApp } from './app.js';
import { config } from './config.js';
import { dbKind, initDb } from './db.js';
import { aiEnabled } from './insights.js';

await initDb();

createApp().listen(config.port, () => {
  console.log(`LeadLens API on http://localhost:${config.port}  (db: ${dbKind}, ai insights: ${aiEnabled() ? config.aiModel : 'off'})`);
});
