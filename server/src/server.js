const app = require('./app');
const env = require('./config/env');
const { startBackgroundMaintenance } = require('./services/maintenance.service');
const { startScheduledBackups } = require('./services/backup.service');

app.listen(env.port, () => {
  console.log(`SSAS API listening on http://localhost:${env.port}`);
  startBackgroundMaintenance();
  // NFR10: daily automated backup, plus one on boot so a new deployment has a restore point
  // straight away rather than after the first 24 hours.
  if (env.backupsEnabled) startScheduledBackups();
});
