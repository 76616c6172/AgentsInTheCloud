import { randomBytes } from "node:crypto";

export const mobileSwipeScriptPath = "/.agents-in-the-cloud/mobile-swipe.js";
const bridgeHeader = "x-agents-in-the-cloud-swipe-bridge";
let script: Promise<string> | undefined;

/** Same-origin bundle on each ingress, including the Desktop viewer's fetch backend. */
export async function mobileSwipeScriptResponse(): Promise<Response> {
  script ??= (async () => {
    const build = await Bun.build({
      entrypoints: [new URL("../client/mobile-swipe.ts", import.meta.url).pathname],
      target: "browser", format: "esm", minify: true,
    });
    if (!build.success) throw new AggregateError(build.logs, "Could not build mobile swipe bridge");
    return build.outputs[0]!.text();
  })();
  return new Response(await script, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

/** Authorize just our script; retain all other CSP restrictions, including sandbox. */
export function allowMobileSwipeScript(policy: string, nonce: string, scriptUrl: string): string {
  return policy.split(",").map(part => {
    const directives = part.split(";").map(value => value.trim()).filter(Boolean);
    const fallback = directives.find(value => /^default-src(?:\s|$)/i.test(value));
    const scriptIndex = directives.findIndex(value => /^script-src(?:\s|$)/i.test(value));
    const elementIndex = directives.findIndex(value => /^script-src-elem(?:\s|$)/i.test(value));
    const authorize = (directive: string): string => {
      // Adding a nonce to an effective unsafe-inline policy would disable the app's
      // inline scripts and event handlers. Allow only our exact URL in that case.
      const inlineAllowed = directive.includes("'unsafe-inline'") && !/'(?:nonce-|sha(?:256|384|512)-)/.test(directive);
      const source = inlineAllowed ? scriptUrl : `'nonce-${nonce}'`;
      return `${directive.replace(/\s+'none'(?=\s|$)/g, "")} ${source}`;
    };
    if (scriptIndex >= 0) directives[scriptIndex] = authorize(directives[scriptIndex]!);
    else if (fallback) directives.push(authorize(fallback.replace(/^default-src/i, "script-src")));
    if (elementIndex >= 0) directives[elementIndex] = authorize(directives[elementIndex]!);
    return directives.join("; ");
  }).join(", ");
}

export function injectMobileSwipeBridge(response: Response, publicOrigin: string): Response {
  if (!response.ok || !response.body || [204, 205, 206].includes(response.status) || response.headers.has(bridgeHeader)
    || !/^text\/html(?:;|$)/i.test(response.headers.get("content-type") ?? "")) return response;
  const nonce = randomBytes(18).toString("base64");
  const scriptUrl = new URL(mobileSwipeScriptPath, publicOrigin).href;
  const headers = new Headers(response.headers);
  headers.set(bridgeHeader, "1"); // Nested ingress must not inject a second bridge.
  for (const name of ["content-length", "etag", "content-md5", "content-digest", "repr-digest"]) headers.delete(name);
  for (const name of ["content-security-policy", "content-security-policy-report-only"]) {
    const policy = headers.get(name);
    if (policy) headers.set(name, allowMobileSwipeScript(policy, nonce, scriptUrl));
  }
  const rewritten = new HTMLRewriter()
    .on("head", { element(head) {
      head.prepend(`<script type="module" nonce="${nonce}" src="${scriptUrl}"></script>`, { html: true });
    } })
    .on("meta[http-equiv]", { element(meta) {
      if (meta.getAttribute("http-equiv")?.toLowerCase() !== "content-security-policy") return;
      const policy = meta.getAttribute("content");
      if (policy) meta.setAttribute("content", allowMobileSwipeScript(policy, nonce, scriptUrl));
    } })
    .transform(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
  return rewritten;
}
