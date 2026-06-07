import { buildApp } from './app.js';

const app = buildApp();
const port = Number.parseInt(process.env.PORT ?? '8080', 10);
const host = '0.0.0.0';

app.listen({ port, host }).then((addr) => {
  app.log.info(`nl2sql listening on ${addr}`);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
