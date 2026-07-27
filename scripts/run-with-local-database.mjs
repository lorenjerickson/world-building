import { execFileSync, spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node scripts/run-with-local-database.mjs <command> [...args]");
  process.exit(2);
}

function resolveDatabasePort() {
  try {
    const publishedAddress = execFileSync(
      "docker",
      ["compose", "port", "db", "5432"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    const port = publishedAddress.match(/:(\d+)$/)?.[1];

    if (port) {
      return port;
    }
  } catch {
    // The caller may be preparing the database before the container exists.
  }

  return process.env.DB_PORT?.trim() || "5432";
}

const databasePort = resolveDatabasePort();
const databaseUrl =
  process.env.DEBUG_DATABASE_URL ??
  `postgresql://worldbuilder:password123@127.0.0.1:${databasePort}/worlddb`;

console.log(`Using local PostgreSQL on 127.0.0.1:${databasePort}`);

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    return;
  }

  process.exitCode = code ?? 1;
});
