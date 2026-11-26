export function formatShortcutBinding(binding: string): string {
  const parts = binding.split("+");
  const shifted = parts.includes("Shift");
  return parts.map((part) => {
    switch (part) {
      case "Meta": return "⌘";
      case "Alt": return "⌥";
      case "Control": return "Ctrl+";
      case "Shift": return "⇧";
      case "Backquote": return shifted ? "~" : "`";
      case "Comma": return ",";
      case "Period": return ".";
      case "Slash": return "/";
      case "Quote": return "'";
      case "Semicolon": return ";";
      case "Backslash": return "\\";
      case "Backspace": return "⌫";
      case "BracketLeft": return "[";
      case "BracketRight": return "]";
      default: return part.replace(/^(Key|Digit)/, "");
    }
  }).join("");
}
