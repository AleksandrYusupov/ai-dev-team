export function evaluateGuardConditions(
  requiredGuards: string[],
  guardOutcomes: Record<string, boolean>,
): string[] {
  const failures: string[] = []

  for (const guard of requiredGuards) {
    if (!guardOutcomes[guard]) {
      failures.push(`guard_not_satisfied:${guard}`)
    }
  }

  return failures
}
