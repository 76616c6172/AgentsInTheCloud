import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { agentsInTheCloudDataPath, createProcessFileLock, getAgentsInTheCloudRuntimeContext, shellQuote } from "@agents-in-the-cloud/core";

export function antigravityDataDirectory(): string {
  return agentsInTheCloudDataPath(getAgentsInTheCloudRuntimeContext(), "antigravity");
}

export function antigravityInstallScript(binary: string): string {
  const metadataScript = `const fs = require("node:fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const u = new URL(m.url);
if (u.origin !== "https://storage.googleapis.com" || !u.pathname.startsWith("/antigravity-public/antigravity-cli/") || u.search || u.hash || !/^[a-f0-9]{128}$/.test(m.sha512)) throw new Error("Invalid Antigravity release manifest");
fs.writeFileSync(process.argv[2] + "/url", m.url);
fs.writeFileSync(process.argv[2] + "/checksum", m.sha512 + "  payload\\n");`;
  return `set -eu
binary=${shellQuote(binary)}
if [ ! -x "$binary" ]; then
  case "$(uname -s)" in Linux) os=linux;; Darwin) os=darwin;; *) echo 'Antigravity requires Linux or macOS'; exit 1;; esac
  case "$(uname -m)" in x86_64|amd64) arch=amd64;; arm64|aarch64) arch=arm64;; *) echo 'Unsupported Antigravity architecture'; exit 1;; esac
  mkdir -p "$(dirname "$binary")"
  staging="$(mktemp -d "$(dirname "$binary")/.install-XXXXXX")"
  trap 'rm -rf "$staging"' EXIT
  curl --fail --silent --show-error --location --proto '=https' --max-time 60 "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/\${os}_\${arch}.json" -o "$staging/manifest.json"
  node -e ${shellQuote(metadataScript)} "$staging/manifest.json" "$staging"
  curl --fail --silent --show-error --location --proto '=https' --max-time 300 "$(cat "$staging/url")" -o "$staging/payload"
  (cd "$staging"; sha512sum --check checksum)
  tar -xzf "$staging/payload" -C "$staging" antigravity
  chmod 755 "$staging/antigravity"
  mv "$staging/antigravity" "$binary"
fi
`;
}

const withInstallLock = createProcessFileLock({ label: "Antigravity installation", lockDir: () => join(antigravityDataDirectory(), "install.lock") });

export async function antigravityExecutable(): Promise<string> {
  const binary = join(antigravityDataDirectory(), "bin", "agy");
  await mkdir(dirname(binary), { recursive: true, mode: 0o700 });
  await withInstallLock(async () => {
    if (await Bun.file(binary).exists()) return;
    const process = Bun.spawn(["bash", "-c", antigravityInstallScript(binary)], { stdout: "pipe", stderr: "pipe" });
    const [status] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
    if (status !== 0) throw new Error("Could not install Antigravity CLI. Check the computer's connection to Google's download servers and try again.");
  });
  return binary;
}
