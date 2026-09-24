import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const output = `FnMusic-AMLL-lyrics-v${pkg.version}.zip`;
const dist = resolve("dist");

if (!existsSync(dist)) {
  console.error("未找到 dist 目录，请先运行 npm run build。");
  process.exit(1);
}
if (existsSync(output)) rmSync(output);

if (process.platform === "win32") {
  execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${dist}\*' -DestinationPath '${resolve(output)}' -Force`], { stdio: "inherit" });
} else {
  execFileSync("zip", ["-r", resolve(output), "."], { cwd: dist, stdio: "inherit" });
}

console.log(`已生成 ${output}`);
