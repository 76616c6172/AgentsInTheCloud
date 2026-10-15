import { expect, test } from "bun:test";
import { appImage, distribution, systemImage } from "../src/distribution.ts";
import { appRepository, githubRepository, systemRepository } from "../src/publishing.ts";

test("Nox release tooling and upstream publishing stay on the same fork", () => {
  expect(appRepository).toBe("ghcr.io/76616c6172/agents-in-the-cloud");
  expect(systemRepository).toBe("ghcr.io/76616c6172/agents-in-the-cloud-system");
  expect(githubRepository).toBe("76616c6172/AgentsInTheCloud");
  expect(appImage).toBe(appRepository);
  expect(systemImage).toBe(systemRepository);
  expect(`ghcr.io/${distribution.repository}`).toBe(appRepository);
  expect(distribution.source).toBe(`https://github.com/${githubRepository}`);
});
