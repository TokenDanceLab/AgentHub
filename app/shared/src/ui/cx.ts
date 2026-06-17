/** CSS classname helper: filters falsy values and joins with space. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
