// Separate process: cancellation/OOM cannot affect Pi or commit a partial edit.
// WASI has no preopened directories, environment, or network access.
import { WASI } from 'node:wasi';
import { readFileSync, writeFileSync, statSync, openSync, closeSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const dir = process.argv[2];
const manifest = JSON.parse(readFileSync(new URL('./engine.json', import.meta.url), 'utf8'));
const compressed = readFileSync(new URL('./engine.wasm.gz', import.meta.url));
if (createHash('sha256').update(compressed).digest('hex') !== manifest.sha256) {
  throw new Error('Bundled exhash engine checksum mismatch. Restore the extension or rebuild the engine.');
}
const module = await WebAssembly.compile(gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 }));
const errors = openSync(join(dir, 'stderr.txt'), 'wx', 0o600);

// Each page gets fresh WASI state, but shares one verified/compiled module and
// one killable process. No persistent worker or file access inside WASI.
async function invoke(inputPath, outputPath) {
  const handles = [];
  try {
    const input = openSync(inputPath, 'r'); handles.push(input);
    const output = openSync(outputPath, 'w', 0o600); handles.push(output);
    const wasi = new WASI({ version: 'preview1', args: [], env: {}, preopens: {}, stdin: input, stdout: output, stderr: errors, returnOnExit: true });
    const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
    const code = wasi.start(instance);
    if (code) throw new Error(`exhash engine exited with code ${code}`);
  } finally {
    for (const handle of handles) closeSync(handle);
  }
}

try {
  if (process.argv[3] !== 'read-batch') {
    await invoke(join(dir, 'input.json'), join(dir, 'output.json'));
  } else {
    const { files, cell, ranges } = JSON.parse(readFileSync(join(dir, 'input.json'), 'utf8'));
    if (!Array.isArray(ranges) || ranges.length < 1 || ranges.length > 20 || ranges.some(r => !Number.isInteger(r?.offset) || r.offset < 1 || !Number.isInteger(r?.limit) || r.limit < 1 || r.limit > 2000)) {
      throw new Error('Invalid section read batch');
    }
    const inputPath = join(dir, 'page-input.json'), outputPath = join(dir, 'page-output.json');
    const output = openSync(join(dir, 'output.json'), 'wx', 0o600);
    try {
      writeFileSync(output, '{"pages":[');
      let bytes = 12;
      for (let i = 0; i < ranges.length; i++) {
        writeFileSync(inputPath, JSON.stringify({ action: 'read', files, cell, offset: ranges[i].offset, limit: ranges[i].limit }), { mode: 0o600 });
        await invoke(inputPath, outputPath);
        bytes += statSync(outputPath).size + (i ? 1 : 0);
        if (bytes > 128 * 1024 * 1024) throw new Error('Engine response too large; no edits committed.');
        const page = readFileSync(outputPath, 'utf8');
        const response = JSON.parse(page);
        if (response.error) throw new Error(response.error);
        writeFileSync(output, (i ? ',' : '') + page);
      }
      writeFileSync(output, ']}');
    } finally {
      closeSync(output);
    }
  }
} finally {
  closeSync(errors);
}
