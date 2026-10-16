import { expect, test } from "bun:test";
import { allowMobileSwipeScript, injectMobileSwipeBridge, mobileSwipeScriptPath } from "../src/ingress/mobile-swipe.ts";
import { createWorkspaceIngress } from "@agents-in-the-cloud/proxy-ingress/server";

test("bridge authorization preserves CSP restrictions and authorizes only its nonce or exact URL", () => {
  expect(allowMobileSwipeScript("default-src 'none'; connect-src 'self'; sandbox allow-scripts", "abc", "https://preview.example/.agents-in-the-cloud/mobile-swipe.js"))
    .toBe("default-src 'none'; connect-src 'self'; sandbox allow-scripts; script-src 'nonce-abc'");
  expect(allowMobileSwipeScript("default-src 'self'; script-src 'nonce-app' 'strict-dynamic'; script-src-elem 'none'", "abc", "https://preview.example/.agents-in-the-cloud/mobile-swipe.js"))
    .toBe("default-src 'self'; script-src 'nonce-app' 'strict-dynamic' 'nonce-abc'; script-src-elem 'nonce-abc'");
  expect(allowMobileSwipeScript("script-src 'none', default-src 'none'; img-src https:", "abc", "https://preview.example/.agents-in-the-cloud/mobile-swipe.js"))
    .toBe("script-src 'nonce-abc', default-src 'none'; img-src https:; script-src 'nonce-abc'");
  expect(allowMobileSwipeScript("img-src 'none'", "abc", "https://preview.example/.agents-in-the-cloud/mobile-swipe.js")).toBe("img-src 'none'");
});

test("bridge authorization does not disable existing unsafe-inline scripts or event handlers", () => {
  const url = `https://preview.example${mobileSwipeScriptPath}`;
  expect(allowMobileSwipeScript("script-src 'unsafe-inline'; connect-src 'none'", "abc", url))
    .toBe(`script-src 'unsafe-inline' ${url}; connect-src 'none'`);
  expect(allowMobileSwipeScript("default-src 'unsafe-inline'", "abc", url))
    .toBe(`default-src 'unsafe-inline'; script-src 'unsafe-inline' ${url}`);
  expect(allowMobileSwipeScript("script-src 'unsafe-inline' 'nonce-existing'", "abc", url))
    .toBe("script-src 'unsafe-inline' 'nonce-existing' 'nonce-abc'");
});

test("HTML transformation invalidates byte validators, preserves cookies, and happens once across nested ingress", async () => {
  const response = injectMobileSwipeBridge(new Response("<!doctype html><html><head></head><body></body></html>", {
    headers: {
      "content-type": "text/html; charset=utf-8", "content-length": "58", "etag": '"old"',
      "content-digest": "old", "content-security-policy": "script-src 'none'",
      "set-cookie": "session=kept; HttpOnly",
    },
  }), "https://preview.example");
  expect(response.headers.get("content-length")).toBeNull();
  expect(response.headers.get("etag")).toBeNull();
  expect(response.headers.get("content-digest")).toBeNull();
  expect(response.headers.get("set-cookie")).toBe("session=kept; HttpOnly");
  expect(response.headers.get("content-security-policy")).toMatch(/^script-src 'nonce-[A-Za-z0-9+/]+'$/);
  expect(injectMobileSwipeBridge(response, "https://preview.example")).toBe(response);
  await response.body!.cancel();
});

test("bridge leaves non-HTML, partial responses, redirects and errors untouched", () => {
  for (const response of [
    new Response("bytes", { headers: { "content-type": "application/octet-stream" } }),
    new Response("partial", { status: 206, headers: { "content-type": "text/html" } }),
    new Response("redirect", { status: 302, headers: { "content-type": "text/html" } }),
    new Response("error", { status: 500, headers: { "content-type": "text/html" } }),
  ]) expect(injectMobileSwipeBridge(response, "https://preview.example")).toBe(response);
});

for (const kind of ["fetch", "http"] as const) {
  test(`${kind} ingress serves its bridge without forwarding the reserved script path`, async () => {
    let upstreamRequests = 0;
    const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { upstreamRequests++; return new Response("upstream"); } });
    const ingress = createWorkspaceIngress({
      hostname: "127.0.0.1", resolveWorkspace() {},
      resolveApp(_app, url) {
        return kind === "fetch"
          ? { kind, fetch() { upstreamRequests++; return new Response("upstream"); } }
          : { kind, target: new URL(url.pathname, `http://127.0.0.1:${upstream.port}`) };
      },
    });
    try {
      const opened = await ingress.openCanonical({ workspaceId: "swipe", appKey: "preview" }, mobileSwipeScriptPath);
      const response = await fetch(opened.headers.get("location")!);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
      expect(upstreamRequests).toBe(0);
    } finally { upstream.stop(true); await ingress.stopAll(); }
  });
}
