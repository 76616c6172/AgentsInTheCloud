// Renders prototype fragments with the real design-system renderers and injects them into the template.
import { buttonHtml } from "/work/packages/design-system/src/button/button-html.ts";
import { contentRowHtml } from "/work/packages/design-system/src/content-row/content-row-html.ts";
import { tabHtml, tabStripHtml } from "/work/packages/design-system/src/tab-strip/tab-strip-html.ts";
import { toggleHtml } from "/work/packages/design-system/src/toggle/toggle-html.ts";
import { Icons } from "/work/packages/design-system/src/icons/icons-html.ts";

const agents = [
  { id: "claude", title: "Claude", icon: Icons.Agent, busy: true },
  { id: "pi", title: "Pi", icon: Icons.Subagents, busy: false },
];
const work = [
  { key: "terminal", label: "Terminal", icon: Icons.Terminal },
  { key: "browser", label: "localhost:5173", icon: Icons.Browser },
  { key: "changes", label: "Changes", icon: Icons.Changes },
  { key: "files", label: "Files", icon: Icons.Files },
];
const iconButton = (label: string, icon: string, attrs = "") => buttonHtml({ type: "button", variant: "quiet", content: { kind: "icon-only", iconHtml: icon, label }, attributesHtml: attrs });
const tab = (key: string, title: string, icon: string, busy = false, requestingAttention = false) => tabHtml({
  selected: false, label: { kind: "text", text: title }, iconHtml: icon,
  status: { busy, requestingAttention },
  primary: { tag: "button", attributesHtml: `type="button" data-proto-tab="${key}"` },
});
const chip = (pane: string, label: string, count: number, leading: string | undefined, trailing: string) => contentRowHtml({
  kind: "compact", width: "fit", label: { kind: "text", text: label }, leadingHtml: leading,
  trailingHtml: `<span class="proto-chip-count">${count}</span><i class="status-dot attention proto-chip-dot" aria-hidden="true"></i>${trailing}`,
  element: { tag: "button", attributesHtml: `type="button" data-proto-go="${pane}"` },
});
const workspaces = [
  ["Nox · phone header", "running"], ["Agent pane refactor", "attention"], ["Release notes 0.42", ""], ["Terminal scrollback", ""], ["Docs cleanup", ""],
] as const;

const fragments = {
  sidebar: iconButton("Show workspaces", `${Icons.Sidebar}<i class="status-dot attention proto-sidebar-dot" aria-hidden="true"></i>`, 'data-proto-go="workspaces"'),
  more: iconButton("More", Icons.More),
  agentTabs: Object.fromEntries(agents.map(a => [`agent:${a.id}`, tab(`agent:${a.id}`, a.title, a.icon, a.busy)])),
  workTabs: Object.fromEntries(work.map(w => [`work:${w.key}`, tab(`work:${w.key}`, w.label, w.icon)])),
  changesWaiting: tab("work:changes", "Changes", Icons.Changes, false, true),
  agentStrip: tabStripHtml({ id: "proto_agent_tabs", label: "Agents", tabsHtml: "%TABS%" }),
  workStrip: tabStripHtml({ id: "proto_work_tabs", label: "Work views", tabsHtml: "%TABS%" }),
  chipWork: chip("work", "Work", work.length, undefined, `<span class="proto-flip">${Icons.Back}</span>`),
  chipAgents: chip("agents", "Agents", agents.length, Icons.Back, ""),
  paneToggle: toggleHtml({ variant: "text-subtle", label: "Pane", name: "pane", value: "agents", options: [{ value: "agents", label: "Agents" }, { value: "work", label: "Work" }] }),
  variantToggle: toggleHtml({ variant: "button", label: "Direction", name: "variant", value: "a", options: ["a", "b", "c", "d", "e"].map(v => ({ value: v, label: v.toUpperCase() })) }),
  themeToggle: toggleHtml({ variant: "button", label: "Theme", name: "theme", value: "nox-oscura", options: [{ value: "nox-oscura", label: "Nox Oscura" }, { value: "daylight", label: "Daylight" }] }),
  attentionToggle: toggleHtml({ variant: "button", label: "Work needs attention", name: "attention", value: "on", options: [{ value: "off", label: "Quiet" }, { value: "on", label: "Changes waiting" }] }),
  prev: iconButton("Previous direction", Icons.Back, 'data-proto-step="-1"'),
  next: iconButton("Next direction", Icons.Next, 'data-proto-step="1"'),
  loopToggle: toggleHtml({ variant: "button", label: "Loop motion", name: "loop", value: "carousel", options: [{ value: "carousel", label: "Carousel" }, { value: "deck", label: "Deck" }] }),
  dockToggle: toggleHtml({ variant: "button", label: "Sidebar button on Work", name: "dock", value: "edge", options: [{ value: "edge", label: "Outer edge" }, { value: "inside", label: "Before More" }] }),
  sidebarRight: iconButton("Show workspaces", `${Icons.Sidebar}<i class="status-dot attention proto-sidebar-dot" aria-hidden="true"></i>`, 'data-proto-go="workspaces-right"'),
  hint: buttonHtml({ type: "button", variant: "secondary", content: { kind: "caption", caption: "Replay first-open hint", iconHtml: Icons.Refresh }, attributesHtml: "data-proto-hint" }),
  workspaceRows: workspaces.map(([title, state], i) => contentRowHtml({
    kind: "compact", width: "fill", label: { kind: "text", text: title },
    leadingHtml: state === "running" ? '<span class="status-spinner" aria-hidden="true"></span>' : state === "attention" ? '<i class="status-dot attention" aria-hidden="true"></i>' : Icons.Workspace,
    element: { tag: "button", attributesHtml: `type="button"${i === 0 ? ' aria-current="page" data-proto-go="agents"' : ""}` },
  })).join(""),
  newWorkspace: contentRowHtml({ kind: "compact", width: "fill", label: { kind: "text", text: "New workspace" }, leadingHtml: Icons.Plus, element: { tag: "button", attributesHtml: 'type="button"' } }),
  icons: { Terminal: Icons.Terminal, Browser: Icons.Browser, Agent: Icons.Agent, Panel: Icons.Panel, Workspace: Icons.Workspace },
};
const [templateName = "template.html", outputName = "phone-swipe-cues-prototype.html"] = process.argv.slice(2);
const template = await Bun.file(`${import.meta.dir}/${templateName}`).text();
const json = JSON.stringify({ ...fragments, agents: agents.map(({ id, title }) => ({ id, title })), work: work.map(({ key, label }) => ({ key, label })) }).replaceAll("</", "<\\/");
await Bun.write(`/work/apps/web/public/prototypes/${outputName}`, template.replace("/*FRAGMENTS*/", json));
console.log("written");
