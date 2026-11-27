import { expect, test } from "bun:test";
import {
  formatNoxRelativeTime,
  groupWorkspacesByTemplate,
  noxWorkspaceSubtitle,
  renderNoxWorkspaceRows,
  type NoxWorkspaceListEntry,
} from "../src/server/nox-workspace-list.ts";

test("groups workspaces by template with No Template last, sorting attention -> active -> idle inside each group", () => {
  const tplA = { id: "tpl-a", title: "agents-in-the-cloud" };
  const tplB = { id: "tpl-b", title: "personal-lab" };
  const workspaces: NoxWorkspaceListEntry[] = [
    { id: "idle-old", title: "Idle old", parked: false, workspaceTemplate: tplA, lastActivityAt: 100 },
    { id: "scratch", title: "Scratch", parked: false, lastActivityAt: 500 },
    { id: "busy-old", title: "Busy old", parked: false, workspaceTemplate: tplA, busy: true, lastActivityAt: 200 },
    { id: "attn-new", title: "Attention newer", parked: false, workspaceTemplate: tplA, requestingAttention: true, attentionAt: 400, lastActivityAt: 400 },
    { id: "idle-new", title: "Idle new", parked: false, workspaceTemplate: tplA, lastActivityAt: 350 },
    { id: "busy-new", title: "Busy new", parked: false, workspaceTemplate: tplA, busy: true, lastActivityAt: 600 },
    { id: "attn-old", title: "Attention older", parked: false, workspaceTemplate: tplA, requestingAttention: true, attentionAt: 150, lastActivityAt: 150 },
    { id: "lab-idle", title: "Lab idle", parked: false, workspaceTemplate: tplB, lastActivityAt: 10 },
    { id: "lab-busy", title: "Lab busy", parked: false, workspaceTemplate: tplB, busy: true, lastActivityAt: 5 },
  ];

  const groups = groupWorkspacesByTemplate(workspaces);
  expect(groups.map((group) => group.label)).toEqual(["agents-in-the-cloud", "personal-lab", "No Template"]);
  expect(groups[0]!.workspaces.map((workspace) => workspace.id)).toEqual([
    "attn-old",
    "attn-new",
    "busy-new",
    "busy-old",
    "idle-new",
    "idle-old",
  ]);
  expect(groups[1]!.workspaces.map((workspace) => workspace.id)).toEqual(["lab-busy", "lab-idle"]);
  expect(groups[2]!.workspaces.map((workspace) => workspace.id)).toEqual(["scratch"]);
});

test("derives second-line subtitles for every workspace state and formats relative times", () => {
  const now = Date.UTC(2026, 10, 26, 12, 0, 0);
  expect(formatNoxRelativeTime(now - 20_000, now)).toBe("Just now");
  expect(formatNoxRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
  expect(formatNoxRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
  expect(formatNoxRelativeTime(now - 30 * 3_600_000, now)).toBe("Yesterday");
  expect(formatNoxRelativeTime(now - 4 * 86_400_000, now)).toBe("4d ago");

  expect(noxWorkspaceSubtitle({ id: "a", title: "A", parked: false, requestingAttention: true, attentionAt: now - 4 * 60_000 }, now)).toEqual({
    base: "Needs you",
    text: "Needs you · 4m ago",
    timestamp: now - 4 * 60_000,
    state: "attention",
  });
  expect(noxWorkspaceSubtitle({ id: "b", title: "B", parked: false, requestingAttention: true, busy: true }, now).text).toBe("Needs you · Working");
  expect(noxWorkspaceSubtitle({ id: "c", title: "C", parked: false, busy: true, busyAgentKeys: ["1", "2"] }, now).text).toBe("Working · 2 agents");
  expect(noxWorkspaceSubtitle({ id: "d", title: "D", parked: false, lastActivityAt: now - 2 * 3_600_000 }, now).text).toBe("Idle · 2h ago");
  expect(noxWorkspaceSubtitle({ id: "e", title: "E", parked: true, lastActivityAt: now - 30 * 3_600_000 }, now).text).toBe("Parked · Yesterday");
  expect(noxWorkspaceSubtitle({ id: "f", title: "F", parked: false, phase: { kind: "provisioningPhase", status: "working", busy: true } }, now).text).toBe("Starting…");
});

test("renders status counts, template groups, and centered parked disclosure", () => {
  const html = renderNoxWorkspaceRows([
    { id: "w1", title: "One", parked: false, requestingAttention: true, busy: false, workspaceTemplate: { id: "t1", title: "repo" } },
    { id: "w2", title: "Two", parked: false, busy: true, workspaceTemplate: { id: "t1", title: "repo" } },
    { id: "w3", title: "Three", parked: false, workspaceTemplate: { id: "t1", title: "repo" } },
    { id: "w4", title: "Four", parked: true, workspaceTemplate: { id: "t1", title: "repo" } },
  ], (workspace) => `<div data-row="${workspace.id}"></div>`);

  expect(html).toContain("1 Done");
  expect(html).toContain("1 Running");
  expect(html).toContain("1 Idle");
  expect(html).toContain('data-nox-template-group="t1"');
  expect(html).toContain('id="workspace_pane_parked"');
  expect(html).toContain("Parked (1)");
});
