import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const frontendDir = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const repositoryDir = resolve(frontendDir, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
}

run(npmCommand, ["run", "build"], frontendDir);
run("cargo", ["test", "--test", "spec06_frontend_browser", "--", "--ignored", "--nocapture"], repositoryDir);
