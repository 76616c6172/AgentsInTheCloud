import { describe, expect, test } from "bun:test";
import { agentsInTheCloudThemes, isAgentsInTheCloudTheme, parseThemeSettings, themeAppearance } from "../src/theme.ts";

describe("theme settings shared by the app and System", () => {
  test.each([...agentsInTheCloudThemes])("accepts and restores $id", ({ id, appearance }) => {
    expect(isAgentsInTheCloudTheme(id)).toBe(true);
    expect(parseThemeSettings(JSON.stringify({ theme: id }), "nord")).toBe(id);
    expect(themeAppearance(id)).toBe(appearance);
  });

  test("older settings with an absent or removed theme use the supplied default", () => {
    expect(parseThemeSettings(undefined, "nox-oscura")).toBe("nox-oscura");
    expect(parseThemeSettings("{}", "nox-oscura")).toBe("nox-oscura");
    expect(parseThemeSettings('{"theme":"removed-theme"}', "nox-oscura")).toBe("nox-oscura");
  });

  test("rejects invalid theme values and malformed settings", () => {
    expect(isAgentsInTheCloudTheme("unregistered")).toBe(false);
    expect(isAgentsInTheCloudTheme(null)).toBe(false);
    expect(() => parseThemeSettings('{"theme":42}', "nord")).toThrow("Invalid theme settings");
    expect(() => parseThemeSettings("not json", "nord")).toThrow();
  });
});
