export function isMissingPostgresFunctionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";

  return (
    code === "42883" ||
    code === "PGRST202" ||
    message.includes("could not find the function") ||
    message.includes("function") && message.includes("does not exist")
  );
}
