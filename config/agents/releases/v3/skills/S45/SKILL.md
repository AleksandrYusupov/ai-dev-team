# S45 — Prompt/Instruction Tuner

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Optimizes skill descriptions, frontmatter, and agent instructions for better triggering accuracy and reduced prompt bloat through systematic trigger analysis, ambiguity detection, and brevity optimization.
- Why: Skills and AGENTS.md files grow fast and start interfering with each other. Without active tuning, overtriggering wastes tokens while undertriggering causes silent skill misses.

## When To Use
- When a skill is firing on tasks it should not handle (overtriggering) or failing to fire on tasks it should handle (undertriggering).
- When total prompt size across loaded skills exceeds budget thresholds and bloat reduction is needed.
- When new skills are added and existing descriptions need disambiguation to prevent overlap.
- Do NOT use for changing skill logic or steps — this skill tunes only the selection/triggering layer, not execution behavior.

## Inputs
- Target skill set: list of SKILL.md files and/or AGENTS.md sections to analyze.
- Trigger logs (if available): recent invocation history showing which skills fired for which task types.
- Overlap report (if available): pairs of skills that triggered on the same input.
- Token budget: maximum allowed prompt size for the skill pack or agent context window.

## Steps

1. **Inventory current descriptions** — collect all Description, Why, and When To Use fields from the target skill set. Measure character and token counts per skill. Flag any skill whose description exceeds 200 tokens.
2. **Run trigger analysis** — for each skill, identify the set of task patterns it should match (positive triggers) and should not match (negative triggers). Compare against trigger logs if available to find actual overtrigger and undertrigger cases.
3. **Detect ambiguity overlaps** — compare description keywords and When To Use clauses across all skills in the set. Identify pairs where the triggering language is similar enough to cause confusion. Score overlap severity: high (identical triggers), medium (shared keywords), low (thematic proximity).
4. **Fix undertriggers** — for skills that miss valid tasks, add specific trigger phrases to When To Use. Prefer concrete task descriptions ("when a PR review needs a summary") over abstract ones ("when review-related work happens").
5. **Fix overtriggers** — for skills that fire on wrong tasks, sharpen the Description field to exclude false-positive patterns. Add explicit "Do NOT use when" clauses. Remove vague qualifiers ("various", "general", "related") that widen the match surface.
6. **Optimize brevity** — rewrite descriptions to be maximally specific in minimum tokens. Remove redundant phrasing, compress bullet lists, replace prose with structured keywords. Target: each description under 150 tokens without losing trigger precision.
7. **Validate no regressions** — after all edits, re-run the trigger analysis mentally against the known positive and negative cases. Confirm that no previously correct triggers are broken and no previously excluded patterns are now matching.
8. **Emit tuning report** — produce a structured artifact listing: skills modified, changes made, before/after token counts, resolved overlaps, and any remaining ambiguities that need human judgment.

## Stop Conditions
- **Done** when all identified overtrigger and undertrigger issues are resolved and the tuning report is emitted.
- **Done** when total token count is within the specified budget and no high-severity overlaps remain.
- **Stop early** if no trigger logs or overlap data are available and no manual analysis targets are specified — report "insufficient data" rather than guessing.

## Escalation Rules
- Escalate when two skills have identical trigger surfaces and cannot be disambiguated without changing their core purpose.
- Escalate when reducing one skill's description to fit token budget would cause undertriggering on known valid patterns.
- Do NOT escalate for low-severity overlaps or minor token overages — resolve these with brevity optimization.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not change skill execution steps while tuning triggers.** This skill modifies only the selection layer (Description, Why, When To Use), never the Steps or Inputs.
- **Do not optimize for brevity at the cost of precision.** A shorter description that overtriggers is worse than a longer one that triggers correctly.
- **Do not remove "Do NOT use" clauses to save tokens.** Negative triggers are the primary defense against overtriggering.
- **Do not tune skills in isolation.** Trigger accuracy is a property of the full skill set, not individual skills.

## Denied Actions
- Do not modify skill Steps, Inputs, Stop Conditions, or Denied Actions sections.
- Do not delete or archive skills — only tune their triggering metadata.
- Do not fabricate trigger log data or invent overtrigger/undertrigger cases without evidence.
