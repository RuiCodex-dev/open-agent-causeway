import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Fastify from "fastify";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  const pkgPath = join(__dirname, "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

export async function buildServer() {
  const app = Fastify({ logger: true });
  const version = readVersion();

  app.get("/health", async () => ({
    status: "ok",
    service: "causeway",
    version,
  }));

  return app;
}

async function main() {
  const app = await buildServer();
  const port = Number(process.env.PORT) || 8000;
  await app.listen({ host: "0.0.0.0", port });
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
