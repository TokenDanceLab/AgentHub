const RUNTIME_DIAGNOSTIC_PATTERNS = [
  /^Warning:\s*no stdin data received\b[\s\S]*\bproceeding without it\b/i,
] as const;

export function isRuntimeDiagnosticText(value: string | undefined): boolean {
  const text = value?.trim();
  if (!text) return false;
  return RUNTIME_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(text));
}
