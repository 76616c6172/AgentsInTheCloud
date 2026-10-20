// Throwaway static server for prototypes: the real design-system logical URLs + apps/web/public.
import { designSystemStaticFiles } from "/work/packages/design-system/src/assets.ts";
const files = designSystemStaticFiles as Record<string, { url: URL; contentType: string }>;
Bun.serve({
  port: 4173,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const entry = files[path];
    if (entry) return new Response(Bun.file(entry.url.pathname), { headers: { "content-type": entry.contentType, "cache-control": "no-store" } });
    const file = Bun.file(`/work/apps/web/public${path}`);
    if (await file.exists()) return new Response(file, { headers: { "cache-control": "no-store" } });
    return new Response("not found", { status: 404 });
  },
});
console.log("prototype server on :4173");
