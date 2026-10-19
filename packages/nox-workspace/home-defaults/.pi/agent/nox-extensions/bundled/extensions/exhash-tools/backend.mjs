import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm, stat, lstat, realpath, open, rename, unlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { resolve, join, dirname, basename, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_OUTPUT_LINES = 2000;
const MAX_COMMANDS = 500;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const OPS = { substitute: 's', delete: 'd', append: 'a', insert: 'i', change: 'c', join: 'j', move: 'm', copy: 't', indent: '>', dedent: '<', sort: 'sort', print: 'p', transliterate: 'y' };
const FIELDS = { substitute: ['pattern', 'replacement', 'global', 'caseInsensitive'], append: ['text'], insert: ['text'], change: ['text'], move: ['destination', 'destinationPath', 'destinationCell'], copy: ['destination', 'destinationPath', 'destinationCell'], indent: ['levels'], dedent: ['levels'], transliterate: ['sourceChars', 'targetChars'] };
const LANGS = { '.py': 'python', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.ts': 'typescript', '.tsx': 'tsx', '.rs': 'rust', '.zig': 'zig', '.swift': 'swift' };

const execFileAsync = promisify(execFile);
let nodeRuntime;
const NODE_PROBE = `
  if (process.versions.bun || Number(process.versions.node?.split('.')[0]) < 22)
    throw new Error('Node 22+ is required');
  const { WASI } = await import('node:wasi');
  new WASI({ version: 'preview1', args: [], env: {}, preopens: {}, returnOnExit: true }).getImportObject();
  console.log(JSON.stringify({ execPath: process.execPath, version: process.versions.node }));
`;

// A standalone Pi executable (including a bundled Node runtime) is not a Node
// CLI. Probe candidates before passing them a worker script; pin the resulting
// absolute path so PATH shims are not re-resolved for every engine request.
export async function resolveNodeRuntime({ execPath = process.execPath, env = process.env } = {}, signal) {
  const candidates = env.PI_EXHASH_NODE ? [env.PI_EXHASH_NODE] : [...new Set([execPath, 'node'])];
  const failures = [];
  for (const candidate of candidates) {
    abort(signal);
    try {
      const { stdout } = await execFileAsync(candidate, ['--no-warnings', '--input-type=module', '--eval', NODE_PROBE], {
        env: { ...env, NODE_OPTIONS: '' }, signal, timeout: 5000,
        killSignal: 'SIGKILL', maxBuffer: 16 * 1024, windowsHide: true,
      });
      const runtime = JSON.parse(stdout);
      if (!isAbsolute(runtime.execPath) || !/^\d+\./.test(runtime.version) || Number(runtime.version.split('.')[0]) < 22) {
        throw new Error('Invalid Node runtime probe response');
      }
      return runtime;
    } catch (error) {
      abort(signal);
      failures.push(`${candidate}: ${String(error.stderr?.trim() || error.message).slice(0, 400)}`);
    }
  }
  throw new Error(`exhash requires Node 22+ with node:wasi. Install Node on PATH or set PI_EXHASH_NODE to a Node executable, then reload Pi. No edits committed.\n${failures.join('\n')}`);
}

function abort(signal) { if (signal?.aborted) throw new Error('Operation aborted; no edits committed.'); }
function integer(value, fallback, name, max) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`${name} must be an integer from 0 to ${max}`);
  return value;
}
export function resolvePath(cwd, path) {
  if (typeof path !== 'string' || !path || path.includes('\0')) throw new Error('A non-empty path is required');
  if (path.startsWith('@')) path = path.slice(1);
  if (path === '~') path = homedir();
  else if (/^~[/\\]/.test(path)) path = join(homedir(), path.slice(2));
  return resolve(cwd, path);
}
export async function canonicalPath(path) {
  try { return await realpath(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A broken symlink must not be replaced by a new regular file.
    const info = await lstat(path).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (info?.isSymbolicLink()) throw new Error(`Broken symlink: ${path}`);
    return join(await realpath(dirname(path)), basename(path));
  }
}
function decode(bytes, path) {
  if (bytes.includes(0)) throw new Error(`Binary file rejected (NUL byte): ${path}`);
  try { return decoder.decode(bytes); } catch { throw new Error(`Non-UTF8 file rejected: ${path}`); }
}
async function snapshot(path, missing = false) {
  let handle;
  try {
    handle = await open(path, 'r');
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`Not a regular file: ${path}`);
    if (info.size > MAX_FILE_BYTES) throw new Error(`File exceeds the 16 MiB safety limit: ${path}`);
    const bytes = await handle.readFile();
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`File grew beyond the 16 MiB safety limit: ${path}`);
    return { path, bytes, text: decode(bytes, path), info, exists: true };
  } catch (e) {
    if (e.code === 'ENOENT' && missing) return { path, bytes: Buffer.alloc(0), text: '', info: null, exists: false };
    throw e;
  } finally { await handle?.close(); }
}

export async function runEngine(request, signal, { timeoutMs = 30_000 } = {}) {
  abort(signal);
  const runtime = nodeRuntime ??= await resolveNodeRuntime({}, signal);
  abort(signal);
  const dir = await mkdtemp(join(tmpdir(), 'pi-exhash-job-'));
  try {
    const input = JSON.stringify(request);
    if (Buffer.byteLength(input) > 4 * MAX_TOTAL_BYTES) throw new Error('Engine request is too large');
    await writeFile(join(dir, 'input.json'), input, { mode: 0o600 });
    abort(signal);
    await new Promise((done, reject) => {
      // No shell, Python, npm install, or runtime downloads.
      // Node 22's WASI fast-API fd_write can GC through an invalid optimized
      // frame on large reports (reproduced SIGSEGV). Use the worker's version,
      // not the host's Node compatibility version (e.g. Bun's).
      const flags = runtime.version.startsWith('22.') ? ['--no-turbo-fast-api-calls'] : [];
      const child = spawn(runtime.execPath, ['--no-warnings', ...flags, join(ROOT, 'runner.mjs'), dir, request.action], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' } });
      let errorText = '', reason, hardKill;
      const stop = message => {
        if (reason) return;
        reason = message;
        child.kill('SIGTERM');
        hardKill = setTimeout(() => child.kill('SIGKILL'), 500);
        hardKill.unref();
      };
      const cancel = () => stop('Operation aborted; no edits committed.');
      const timer = setTimeout(() => stop(`exhash computation exceeded ${timeoutMs}ms; no edits committed.`), timeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      child.stderr.on('data', b => { if (errorText.length < 8000) errorText += b.toString('utf8').slice(0, 8000 - errorText.length); });
      const cleanup = () => { clearTimeout(timer); clearTimeout(hardKill); signal?.removeEventListener('abort', cancel); };
      child.on('error', e => { cleanup(); reject(e); });
      child.on('close', (code, exitSignal) => {
        cleanup();
        if (reason || code !== 0) reject(new Error(reason || `exhash engine failed (${exitSignal ?? code}); no edits committed: ${errorText}`));
        else done();
      });
    });
    abort(signal);
    const outputPath = join(dir, 'output.json');
    if ((await stat(outputPath)).size > 4 * MAX_TOTAL_BYTES) throw new Error('Engine response too large; no edits committed.');
    const response = JSON.parse(await readFile(outputPath, 'utf8'));
    if (response.error) throw new Error(response.error);
    return response;
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// Explicit fields, rather than file-qualified strings, work with Windows drive
// letters and paths containing colons/backslashes without another escaping layer.
export function commandFields(command, allowUnverified = false) {
  const op = OPS[command.op];
  if (!op) throw new Error(`Unknown operation: ${command.op}`);
  const allowed = new Set(['path', 'cell', 'address', 'op', 'where', 'invert', ...(FIELDS[command.op] ?? [])]);
  for (const key of Object.keys(command)) if (!allowed.has(key)) throw new Error(`${key} is not valid for ${command.op}`);
  if (command.invert && command.where === undefined) throw new Error('invert requires where');
  const required = key => {
    if (typeof command[key] !== 'string') throw new Error(`${command.op} requires ${key}`);
    return command[key];
  };
  const address = required('address').trim();
  validateAddress(address, command.op === 'print', allowUnverified);
  let fields = [op];
  switch (op) {
    case 's': fields.push(required('pattern'), required('replacement'), `${command.global ? 'g' : ''}${command.caseInsensitive ? 'i' : ''}`); break;
    case 'a': case 'i': case 'c': fields.push(required('text')); break;
    case 'm': case 't': {
      if (command.where !== undefined) throw new Error('where cannot wrap move/copy; select an explicit source range instead');
      const dest = required('destination').trim();
      validateAddress(dest, false, allowUnverified, true);
      fields.push(dest); break;
    }
    case '>': case '<': fields.push(String(integer(command.levels, 1, 'levels', 256))); break;
    case 'y': fields.push(required('sourceChars'), required('targetChars')); break;
  }
  if (command.where !== undefined) fields = [command.invert ? 'v' : 'g', required('where'), fields];
  return [address, ...fields];
}
function validateAddress(address, print, allowUnverified, destination = false) {
  if (/\|[a-fA-F0-9]{4}\|/.test(address)) throw new Error('Old four-hex exhash address. Re-read with exhash_read; addresses now have two Base64url characters.');
  const atom = String.raw`(?:\d+\|[A-Za-z0-9_-]{2}\||\$${print ? '|[1-9]\\d*' : ''})`;
  const regex = new RegExp(`^(?:${destination ? '' : '%|'}${atom}${destination ? '' : `\\s*,\\s*${atom}|${atom}`})$`);
  if (!regex.test(address)) throw new Error(`Invalid ${destination ? 'destination' : 'source'} address: ${address}. Copy only the address, not content or commands.`);
  if (!print && !allowUnverified && /[%$]/.test(address)) throw new Error('Hashless %/$ edits require allowUnverified: true. Prefer a freshly read hashed range.');
}

// Bound model and TUI output independently from the computation/commit. Retain the
// full report before committing, so truncation can never turn success into error.
export async function formatOutput(text) {
  let bytes = 0, clipped = false;
  const rows = [], lines = text.split('\n');
  for (const line of lines) {
    if (rows.length >= MAX_OUTPUT_LINES) { clipped = true; break; }
    // Long single lines keep their hash address and an explicit content marker.
    const row = line.length > 4000 ? `${line.slice(0, 4000)} … [line content truncated]` : line;
    clipped ||= row !== line;
    const size = Buffer.byteLength(row) + 1;
    if (bytes + size > MAX_OUTPUT_BYTES) { clipped = true; break; }
    rows.push(row); bytes += size;
  }
  let output = rows.join('\n'), fullOutputPath;
  if (clipped) {
    const dir = await mkdtemp(join(tmpdir(), 'pi-exhash-output-'));
    fullOutputPath = join(dir, 'output.txt');
    await writeFile(fullOutputPath, text, { mode: 0o600 });
    output += `\n\n[Output truncated. Full output: ${fullOutputPath}]`;
  }
  return { text: output, fullOutputPath, truncated: clipped };
}

export async function readText(params, cwd, signal) {
  const path = await canonicalPath(resolvePath(cwd, params.path));
  const file = await snapshot(path);
  const offset = integer(params.offset, 1, 'offset', Number.MAX_SAFE_INTEGER);
  const limit = integer(params.limit, 2000, 'limit', 2000);
  if (!offset || !limit) throw new Error('offset and limit must be at least 1');
  const result = await runEngine({ action: 'read', files: [{ id: '0', name: params.path, text: file.text }], cell: params.cell, offset, limit, pattern: params.pattern }, signal);
  const output = await formatOutput(result.text || `(No matching lines; ${result.totalLines} total lines.)`);
  // If display truncation omitted rows, continue after the last displayed source
  // line, not after the engine's larger page. Long rows are never an empty page.
  const shown = [...output.text.matchAll(/^(\d+)\|[A-Za-z0-9_-]{2}\|/gm)];
  const last = shown.at(-1)?.[1];
  const fullRows = result.text ? result.text.split('\n').length : 0;
  const nextOffset = shown.length < fullRows && last ? Number(last) + 1 : result.nextOffset;
  if (nextOffset) output.text += `\n[Continue with offset=${nextOffset}${params.pattern ? ' and the same pattern' : ''}.]`;
  return { ...output, totalLines: result.totalLines, nextOffset: nextOffset ?? null, changed: [] };
}

async function unchanged(file) {
  const now = await snapshot(file.path, true);
  const metadataChanged = now.exists && ['mode', 'ino', 'dev', 'uid', 'gid'].some(key => now.info[key] !== file.info?.[key]);
  if (now.exists !== file.exists || !now.bytes.equals(file.bytes) || metadataChanged) {
    throw new Error(`File changed during exhash computation: ${file.path}. Re-read before retrying.`);
  }
}
async function stage(path, bytes, info) {
  const name = join(dirname(path), `.pi-exhash-${randomUUID()}.tmp`);
  const handle = await open(name, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    if (info && process.platform !== 'win32') {
      const own = await handle.stat();
      if (own.uid !== info.uid || own.gid !== info.gid) await handle.chown(info.uid, info.gid);
      await handle.chmod(info.mode & 0o7777);
    }
    await handle.sync();
    await handle.close();
    return name;
  } catch (e) {
    // Windows cannot unlink an open staging file.
    await handle.close().catch(() => {});
    await rm(name, { force: true }).catch(() => {});
    throw e;
  }
}

function changedBytes(change, path) {
  const bytes = Buffer.from(change.text, 'utf8');
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`Edited file exceeds 16 MiB: ${path}`);
  if (bytes.includes(0)) throw new Error(`Edit would create a binary file (NUL byte): ${path}`);
  return bytes;
}

// OSes don't offer a portable multi-file atomic rename. Stage every file first;
// on an I/O error, roll back only files that still contain our written bytes.
// Retain a recovery copy rather than overwrite a concurrent external change.
export async function commitChanges(changes, files, aliases, signal, { replace = rename } = {}) {
  const staged = [], committed = [], keep = new Set();
  try {
    for (const change of changes) {
      const file = files.find(f => f.id === change.id);
      if (!file) throw new Error('Engine returned an unknown file');
      const bytes = changedBytes(change, file.path);
      const entry = { file, bytes, pending: await stage(file.path, bytes, file.info), backup: null };
      staged.push(entry);
      if (file.exists) entry.backup = await stage(file.path, file.bytes, file.info);
    }
    abort(signal);
    for (const [alias, canonical] of aliases) {
      if (await canonicalPath(alias) !== canonical) throw new Error(`Symlink target changed: ${alias}`);
    }
    for (const file of files) await unchanged(file);
    abort(signal);
    // Commit boundary: finish or roll back; cancellation no longer interrupts.
    for (const entry of staged) {
      await unchanged(entry.file);
      await replace(entry.pending, entry.file.path);
      committed.push(entry);
    }
  } catch (error) {
    const recovery = [];
    for (const entry of committed.reverse()) {
      try {
        const current = await readFile(entry.file.path);
        if (!current.equals(entry.bytes)) throw new Error('external writer changed the committed file');
        if (entry.backup) await replace(entry.backup, entry.file.path);
        else await unlink(entry.file.path);
      } catch (rollback) {
        if (entry.backup) keep.add(entry.backup);
        recovery.push(`${entry.file.path}: ${rollback.message}${entry.backup ? `; original retained at ${entry.backup}` : '; newly created file may remain'}`);
      }
    }
    throw new Error(`${error.message}\n${recovery.length ? `Partial commit; DO NOT retry blindly. Recovery:\n${recovery.join('\n')}` : 'No edits committed (any completed replacements were rolled back).'}`);
  } finally {
    for (const e of staged) for (const name of [e.pending, e.backup]) if (name && !keep.has(name)) await rm(name, { force: true }).catch(() => {});
  }
}

export async function editText(params, cwd, signal, queue) {
  if (!Array.isArray(params.commands) || !params.commands.length || params.commands.length > MAX_COMMANDS) throw new Error(`Provide 1-${MAX_COMMANDS} commands`);
  const shiftWidth = integer(params.shiftWidth, 4, 'shiftWidth', 256);
  const aliases = new Map(), targets = new Map(), commands = [];
  const target = async name => {
    const requested = resolvePath(cwd, name);
    const path = await canonicalPath(requested);
    aliases.set(requested, path);
    if (!targets.has(path)) targets.set(path, { id: String(targets.size), path, name });
    return targets.get(path);
  };
  for (const c of params.commands) {
    const fields = commandFields(c, params.allowUnverified ?? false);
    const src = await target(c.path ?? params.path);
    const cell = c.cell !== undefined ? (c.cell ?? undefined) : params.cell;
    const dest = ['move', 'copy'].includes(c.op) ? await target(c.destinationPath ?? c.path ?? params.path) : null;
    commands.push({ file: src.id, cell, fields, destinationFile: dest?.id, destinationCell: c.destinationCell !== undefined ? c.destinationCell : (dest?.id === src.id ? cell : undefined) });
  }
  const ordered = [...targets.values()].sort((a, b) => a.path.localeCompare(b.path));
  const locked = async index => {
    if (index < ordered.length) return queue(ordered[index].path, () => locked(index + 1));
    abort(signal);
    const files = [];
    for (const t of targets.values()) files.push({ ...t, ...await snapshot(t.path, true) });
    if (files.reduce((n, f) => n + f.bytes.length, 0) > MAX_TOTAL_BYTES) throw new Error('Total input exceeds 32 MiB');
    for (const f of files.filter(f => !f.exists)) {
      const creation = commands.some(c => (c.file === f.id && !c.cell && c.fields[0] === '0|AA|' && ['a', 'i'].includes(c.fields[1])) || (c.destinationFile === f.id && !c.destinationCell && c.fields[2] === '0|AA|' && ['m', 't'].includes(c.fields[1])));
      if (!creation) throw new Error(`File not found: ${f.path}. Create with 0|AA| append/insert or a transfer to 0|AA|.`);
    }
    const result = await runEngine({ action: 'edit', files: files.map(f => ({ id: f.id, name: f.name, text: f.text })), commands, shiftWidth }, signal);
    const changed = result.changes.map(c => {
      const file = files.find(f => f.id === c.id);
      if (!file) throw new Error('Engine returned an unknown file');
      changedBytes(c, file.path); // Preview and apply have the same output constraints.
      return file.path;
    });
    const prefix = params.dryRun ? 'Preview only; no files written.\n' : changed.length ? `Applied changes to ${changed.length} file(s).\n` : 'No changes.\n';
    const output = await formatOutput(prefix + result.text);
    const display = output.text.replace(/^([ +\-])(\d+)\|[A-Za-z0-9_-]{2}\|/gm, '$1$2|');
    if (!params.dryRun && changed.length) await commitChanges(result.changes, files, aliases, signal);
    return { ...output, changed, dryRun: !!params.dryRun, committed: !params.dryRun && !!changed.length, diff: display };
  };
  return locked(0);
}

async function documentSource(path, cwd, signal) {
  if (!/^https?:\/\//i.test(path)) return { ...(await snapshot(await canonicalPath(resolvePath(cwd, path)))), name: path };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 30_000);
  try {
    abort(signal);
    const response = await fetch(path, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
    let size = 0; const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_FILE_BYTES) { controller.abort(); throw new Error('Document exceeds 16 MiB'); }
      chunks.push(chunk);
    }
    return { text: decode(Buffer.concat(chunks), path), name: response.url };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
function sectionTokens(sections) {
  const stack = [], counters = [];
  return sections.map(s => {
    while (stack.length && stack.at(-1) >= s.level) { stack.pop(); }
    const depth = stack.length;
    counters[depth] = (counters[depth] ?? 0) + 1;
    counters.length = depth + 1;
    stack.push(s.level);
    return { ...s, depth: depth + 1, token: `${counters.join('.')}.|${s.address}` };
  });
}
export async function openDocument(params, cwd, signal) {
  const modes = [params.tokens !== undefined, params.pattern !== undefined, !!params.links].filter(Boolean).length;
  if (modes > 1) throw new Error('Use only one of tokens, pattern, or links');
  const source = await documentSource(params.path, cwd, signal);
  const request = { files: [{ id: '0', name: source.name, text: source.text }], cell: params.cell };
  if (params.pattern !== undefined) {
    const result = await runEngine({ ...request, action: 'read', pattern: params.pattern, offset: params.offset, limit: params.limit }, signal);
    const output = await formatOutput(result.text || '(No matching lines.)');
    const shown = [...output.text.matchAll(/^(\d+)\|[A-Za-z0-9_-]{2}\|/gm)];
    const next = shown.length < (result.text ? result.text.split('\n').length : 0) ? Number(shown.at(-1)?.[1] ?? 0) + 1 : result.nextOffset;
    if (next) output.text += `\n[Continue with offset=${next} and the same pattern.]`;
    return { ...output, changed: [], nextOffset: next ?? null };
  }
  const suffix = extname(/^https?:/.test(source.name) ? new URL(source.name).pathname : source.name).toLowerCase();
  const result = await runEngine({ ...request, action: 'outline', language: params.language ?? (params.cell ? undefined : LANGS[suffix]) }, signal);
  let text;
  if (result.cells) {
    if (params.tokens || params.links) throw new Error('Select a notebook cell with cell before navigating its sections');
    text = result.cells.map(c => `# cell ${c.id ?? '(missing ID)'} [${c.type}; ${c.lines} lines] ${c.preview}`).join('\n') + '\n[Pass cell to exhash_read/exhash_edit/exhash_open; IDs accept unique prefixes.]';
  } else if (params.links) {
    text = result.links.map(l => {
      let url = l.url;
      if (/^https?:/.test(source.name)) url = new URL(url, source.name).href;
      else if (!/^[a-z][a-z\d+.-]*:/i.test(url)) url = resolve(dirname(resolvePath(cwd, params.path)), url);
      return `[${l.number}] ${l.text} → ${url}`;
    }).join('\n') || '(No inline links.)';
  } else {
    const sections = sectionTokens(result.sections);
    if (params.tokens) {
      if (!Array.isArray(params.tokens) || params.tokens.length < 1 || params.tokens.length > 20) throw new Error('Provide 1–20 section tokens');
      // Validate every token against this snapshot before starting section reads.
      const selected = params.tokens.map(token => {
        const section = sections.find(s => s.token === token);
        if (!section) throw new Error(`Stale or invalid section token: ${token}. Re-open the outline.`);
        return section;
      });
      const { pages } = await runEngine({ ...request, action: 'read-batch', ranges: selected.map(section => ({ offset: section.start, limit: Math.min(section.end - section.start + 1, 2000) })) }, signal);
      text = selected.map((section, i) => `# ${section.token}\n${pages[i].text}${section.end - section.start + 1 > 2000 ? `\n[Section continues; use exhash_read offset=${section.start + 2000}.]` : ''}`).join('\n\n');
    } else {
      text = sections.filter(s => !params.depth || s.depth <= params.depth).map(s => `${'  '.repeat(s.depth - 1)}${s.token} ${s.title} [${s.start}-${s.end}] ${s.preview}`).join('\n');
      if (!text) text = `(No sections; ${result.totalLines} lines. Use exhash_read for local text or pattern for document search.)`;
      else text += '\n[Copy tokens to view sections; the start,end hash pair after .| is an edit-ready range.]';
    }
  }
  return { ...await formatOutput(text), changed: [] };
}
