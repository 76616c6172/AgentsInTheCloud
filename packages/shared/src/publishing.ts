/**
 * Where this checkout publishes its images and releases, and where installations update from.
 * Forks change these two lines to their own registry account and GitHub repository.
 */
export const imageNamespace = "ghcr.io/76616c6172";
export const githubRepository = "76616c6172/AgentsInTheCloud";

export const appRepository = `${imageNamespace}/agents-in-the-cloud`;
export const systemRepository = `${imageNamespace}/agents-in-the-cloud-system`;
export const runtimeRepository = `${imageNamespace}/agents-in-the-cloud-docker`;
