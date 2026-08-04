const app = require('./app');
const env = require('./config/env');

app.listen(env.port, () => {
  console.log(`SSAS API listening on http://localhost:${env.port}`);
});
