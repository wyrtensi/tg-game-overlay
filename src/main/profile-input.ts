export function normalizeProfileExecutable(value: string): string | null {
  const unquoted = value.trim().replace(/^"|"$/g, "");
  const parts = unquoted.split(/[\\/]/);
  const executable = (parts[parts.length - 1] ?? "").trim().toLowerCase();
  return executable.endsWith(".exe") ? executable : null;
}
