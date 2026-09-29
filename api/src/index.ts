import Fastify from "fastify";

const server = Fastify({ logger: true });
const port = Number(process.env.PORT ?? 3001);

try {
  await server.listen({ port, host: "0.0.0.0" });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
