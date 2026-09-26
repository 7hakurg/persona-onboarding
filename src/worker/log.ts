type Level = "info" | "warn" | "error";

/** Structured logs. Never pass message content, tokens, or secrets. */
export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: err.name, message: err.message };
  return { error: String(err) };
}
