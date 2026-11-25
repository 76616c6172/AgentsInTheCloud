import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { shellQuote } from "@agents-in-the-cloud/core";
import { antigravityInstallScript } from "../src/server/installation.ts";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

test("installs a verified CLI with the production app's Bun-only JavaScript runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "antigravity-install-"));
  directories.push(directory);
  const path = join(directory, "path");
  await mkdir(path);
  for (const command of ["bun", "uname", "mkdir", "dirname", "mktemp", "rm", "cat", "sha512sum", "tar", "gzip", "chmod", "mv"]) {
    await symlink(Bun.which(command)!, join(path, command));
  }
  const source = "#!/bin/sh\nprintf 'test-antigravity'\n";
  await writeFile(join(directory, "antigravity"), source);
  const archive = join(directory, "payload.tar.gz");
  const tar = Bun.spawn(["tar", "-czf", archive, "-C", directory, "antigravity"], { stdout: "pipe", stderr: "pipe" });
  expect(await tar.exited).toBe(0);
  const manifest = join(directory, "manifest.json");
  const sha512 = createHash("sha512").update(await readFile(archive)).digest("hex");
  await writeFile(manifest, JSON.stringify({ url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/test.tar.gz", sha512 }));
  await writeFile(join(path, "curl"), `#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    https://*/manifests/*) source=${shellQuote(manifest)};;
    https://storage.googleapis.com/*) source=${shellQuote(archive)};;
    -o) shift; output="$1";;
  esac
  shift
done
cat "$source" > "$output"
`);
  await chmod(join(path, "curl"), 0o755);
  const binary = join(directory, "installed", "agy");
  const run = () => Bun.spawn(["/bin/bash", "-c", antigravityInstallScript(binary)], { env: { ...process.env, PATH: path }, stdout: "pipe", stderr: "pipe" });
  const child = run();
  const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
  expect(await readFile(binary, "utf8")).toBe(source);
  expect((await Bun.file(binary).stat()).mode & 0o111).toBe(0o111);
  await rm(join(path, "curl"));
  expect(await run().exited).toBe(0);
});
