import { eslintCompatPlugin } from "@oxlint/plugins";

import { noDockerExecRule } from "./rules/no-docker-exec.ts";

/** Rules specific to AgentsInTheCloud's architecture. */
const agentsInTheCloudPlugin = eslintCompatPlugin({
	meta: { name: "agents-in-the-cloud" },
	rules: {
		"no-docker-exec": noDockerExecRule,
	},
});

export default agentsInTheCloudPlugin;
