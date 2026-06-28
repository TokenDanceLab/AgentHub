const RUNTIME_DIAGNOSTIC_PATTERNS = [
  /^Warning:\s*no stdin data received\b[\s\S]*\bproceeding without it\b/i,
  /^Data:\s*(?:approved-real|auto|demo|fixture|local|login|mock|observed|real)\b/i,
  /^Hub replay:\s*(?:no active Hub session|task\b|\d+\s+runtime events observed\b)/i,
  /^Mode:\s*(?:approved-real|auto|debug|demo|fixture|local|login|mock|observed|real)\b/i,
  /^Runtime:\s*(?:debug|demo|fixture|mock|replay|stubbed|test)\b/i,
  /\bmock \(auto fallback\)/i,
  /\bdemo\+edge\b/i,
] as const;

export function isRuntimeDiagnosticText(value: string | undefined): boolean {
  const text = value?.trim();
  if (!text) return false;
  return RUNTIME_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(text));
}
