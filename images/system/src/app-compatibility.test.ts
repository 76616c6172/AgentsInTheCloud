import { expect, test } from "bun:test";
import { assertAppCompatible } from "./app-compatibility.ts";

test("apps needing at most this System's version start", () => {
  // Images from before versions were labelled need nothing.
  expect(() => assertAppCompatible(undefined, 2)).not.toThrow();
  expect(() => assertAppCompatible(null, 2)).not.toThrow();
  expect(() => assertAppCompatible({}, 2)).not.toThrow();
  for (const version of ["1", "2"])
    expect(() => assertAppCompatible({ "org.agents-in-the-cloud.required-system-version": version }, 2)).not.toThrow();
});

test("apps needing a newer System are refused with installer guidance", () => {
  expect(() => assertAppCompatible({ "org.agents-in-the-cloud.required-system-version": "3" }, 2)).toThrow("needs a newer System (version 3; this one is 2). Run the installer again");
  expect(() => assertAppCompatible({ "org.agents-in-the-cloud.required-system-version": "next" }, 2)).toThrow("Invalid System version");
});
