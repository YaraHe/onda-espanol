import { createServer } from "./app.ts";

const server = createServer();
const port = Number(process.env.PORT ?? 3001);

try {
  await server.listen({ port, host: "0.0.0.0" });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
