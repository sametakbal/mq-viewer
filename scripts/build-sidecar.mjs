// Builds the Java sidecar and stages it for Tauri:
//   src-tauri/resources/mq-sidecar.jar   shaded jar (IBM MQ allclient + Jackson)
//   src-tauri/resources/runtime/         minimal JRE made with jlink
// Usage: node scripts/build-sidecar.mjs [--skip-runtime]
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidecar = join(root, "sidecar");
const resources = join(root, "src-tauri", "resources");
const win = process.platform === "win32";

// Modules the MQ classes for Java touch; jdk.charsets carries the EBCDIC code pages.
const MODULES = [
  "java.base", "java.logging", "java.management", "java.naming", "java.xml", "java.sql",
  "java.transaction.xa", "java.security.jgss", "java.security.sasl", "java.desktop",
  "jdk.charsets", "jdk.crypto.cryptoki", "jdk.localedata", "jdk.unsupported", "jdk.zipfs",
];

function run(cmd, args, cwd) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: win && cmd.endsWith(".cmd") });
}

function findJavaHome() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  // The first java on PATH, resolved to an absolute path before it is run.
  const java = (process.env.PATH ?? "").split(delimiter).filter((d) => isAbsolute(d))
    .map((d) => join(d, win ? "java.exe" : "java")).find((f) => existsSync(f));
  if (!java) throw new Error("No JDK found: set JAVA_HOME or put java on PATH");
  // `java -XshowSettings:properties` prints to stderr.
  const r = spawnSync(java, ["-XshowSettings:properties", "-version"], { encoding: "utf8" });
  const m = /java\.home = (.+)/.exec(r.stderr || "");
  if (!m) throw new Error("No JDK found: set JAVA_HOME or put java on PATH");
  return m[1].trim();
}

mkdirSync(resources, { recursive: true });

run(win ? join(sidecar, "mvnw.cmd") : "./mvnw", ["-q", "-B", "package", "-DskipTests"], sidecar);
cpSync(join(sidecar, "target", "mq-sidecar.jar"), join(resources, "mq-sidecar.jar"));

const runtime = join(resources, "runtime");
if (process.argv.includes("--skip-runtime")) {
  // Tauri needs the resource folder to exist; the app then falls back to the system JDK.
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, ".keep"), "");
} else {
  rmSync(runtime, { recursive: true, force: true });
  const jlink = join(findJavaHome(), "bin", win ? "jlink.exe" : "jlink");
  run(jlink, [
    "--add-modules", MODULES.join(","),
    "--strip-debug", "--no-header-files", "--no-man-pages",
    "--compress", "zip-6",
    "--output", runtime,
  ], root);
}
console.log("sidecar staged in", resources);
