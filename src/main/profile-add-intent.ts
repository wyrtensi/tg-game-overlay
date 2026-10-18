export type ProfileAddIntent = { kind: "pick" } | { kind: "add"; value: string };

export function profileAddIntent(value: string): ProfileAddIntent {
  return value.trim() ? { kind: "add", value } : { kind: "pick" };
}

export function selectedProfileExecutable(path: string | null): string | null {
  return path;
}
