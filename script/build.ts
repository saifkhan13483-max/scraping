import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, copyFile } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "bcryptjs",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-session",
  "ioredis",
  "pg",
  "zod",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // connect-pg-simple reads table.sql relative to its __dirname at runtime.
  // When esbuild bundles it into dist/index.cjs, __dirname resolves to dist/,
  // so we must copy the file there so the session store can create its table.
  console.log("copying connect-pg-simple/table.sql → dist/table.sql...");
  await copyFile(
    "node_modules/connect-pg-simple/table.sql",
    "dist/table.sql",
  );
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
