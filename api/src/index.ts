import { createServer } from "./app.ts";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required for API authentication.");
}

const server = createServer();
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await server.listen({ port, host });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
