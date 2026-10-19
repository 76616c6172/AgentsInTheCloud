import { defineRule } from "@oxlint/plugins";

type Node = { type: string; value?: unknown; elements?: (Node | null)[]; quasis?: { value: { cooked?: string | null } }[] };

function isString(node: Node | null | undefined, value: string): boolean {
  return node?.type === "Literal" && node.value === value;
}

function startsWithExec(node: Node | null | undefined): boolean {
  return node?.type === "ArrayExpression" && isString(node.elements?.[0], "exec");
}

/** Workspaces will not always be containers, so the app reaches them through the workspace helper. */
export const noDockerExecRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow `docker exec`; run workspace processes through the workspace helper." },
    messages: {
      dockerExec:
        "Don’t use `docker exec` to run something in a workspace: workspaces won’t always be containers. Use the workspace helper through `execWorkspaceCommand`, `runInWorkspace` or `startInWorkspace` from @agents-in-the-cloud/workspace. If the container isn’t a workspace, disable this rule on the line and say why.",
    },
  },
  createOnce(context) {
    const report = (node: Parameters<typeof context.report>[0]["node"]) => context.report({ node, messageId: "dockerExec" });
    return {
      // ["docker", "exec", ...]
      ArrayExpression(node) {
        const elements = (node as Node).elements ?? [];
        if (elements.some((element, index) => isString(element, "docker") && isString(elements[index + 1], "exec"))) report(node);
      },
      CallExpression(node) {
        const [first, second] = node.arguments as Node[];
        // spawn("docker", ["exec", ...])
        if (isString(first, "docker") && startsWithExec(second)) report(node);
        // runDocker(["exec", ...]), docker("exec", ...)
        const callee = node.callee.type === "Identifier" ? node.callee.name : node.callee.type === "MemberExpression" && node.callee.property.type === "Identifier" ? node.callee.property.name : "";
        if (/docker/i.test(callee) && (startsWithExec(first) || isString(first, "exec"))) report(node);
      },
      // Shell commands such as `docker exec ...`
      Literal(node) {
        if (typeof node.value === "string" && /\bdocker\s+exec\b/.test(node.value)) report(node);
      },
      TemplateLiteral(node) {
        if ((node as Node).quasis?.some((quasi) => /\bdocker\s+exec\b/.test(quasi.value.cooked ?? ""))) report(node);
      },
    };
  },
});
