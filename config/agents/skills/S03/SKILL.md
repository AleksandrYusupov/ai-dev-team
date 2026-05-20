# S03 — Clarifying Questions Composer

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Формирует один структурированный запрос к человеку вместо расплывчатого «нужны уточнения».
- Why: Ключевой skill для Needs Input.

## When To Use
- When S01 (Triage Classifier) produces a confidence < 0.7 and the specific ambiguities need to be turned into actionable questions.
- When a downstream agent (SpecAgent, PlanAgent) encounters missing information that blocks progress and needs human input.
- When an integration task requires confirmation of prerequisites (auth method, environment, endpoints) before work can begin.
- Do NOT use for questions that agents can resolve themselves by reading existing documentation or code — check F02 context pack first.

## Inputs
- Ambiguity list: specific fields or decisions that are uncertain, with context on why (from S01 triage, SpecAgent gap analysis, or PlanAgent blockers).
- Issue context: title, description, current classification, affected area (from the issue payload and S01 output).
- Task type: bug, feature, integration, migration, etc. (from S01 classification) — determines which question templates apply.
- Existing answers: any information already available from the issue, comments, or context pack (from F02) — to avoid asking questions that are already answered.
- Caller identity: which agent triggered the skill and what decision depends on the answers (from workflow context).

## Steps

1. **Collect raw gaps** — gather all ambiguity items from the calling agent. Each item must have: `field_name` (what is missing), `why_needed` (what decision it unblocks), and `current_guess` (best available inference, if any).
2. **Deduplicate and merge** — if multiple agents or multiple passes have flagged overlapping gaps, merge them. Two gaps about the same underlying question become one question with combined rationale.
3. **Classify each question** — mark every question as `blocking` (work cannot proceed without the answer) or `optional` (work can proceed with a stated assumption, but the assumption may be wrong). Blocking questions appear first in the output.
4. **Generate options per question** — for each question, produce 2-4 concrete answer options when possible. Example: "Which auth method?" -> options: `OAuth2`, `API key`, `Service account`. If the domain is open-ended (e.g., "Describe the expected behavior"), provide a `preferred_answer_shape` instead (e.g., "one sentence describing the user-visible outcome").
5. **Apply integration safeguards** — for integration tasks, include prerequisite questions about auth method, target environment, and API version. Mark these as blocking. NEVER ask for raw secret values (tokens, passwords, keys) — instead ask "Is the credential stored in vault under key X?" or "Which secret manager entry should the agent reference?"
6. **Compose single comment** — assemble all questions into ONE structured comment block. Format:
   - Header: brief context on what the agent is trying to do and why input is needed.
   - Blocking section: numbered list of blocking questions, each with `what_missing`, `why_needed`, `options` or `preferred_answer_shape`.
   - Optional section: numbered list of optional questions in the same format, with a note that the agent will proceed with stated assumptions if unanswered within the configured timeout.
   - Footer: which agent(s) are waiting and what will happen once answers arrive.
7. **Validate completeness** — verify that every question includes `why_needed` (no orphan questions), that no question asks for raw secrets, and that the total comment is under 500 words (concise enough to actually get read and answered).
8. **Emit clarification artifact** — produce a structured output containing: `comment_text` (the formatted comment), `blocking_questions[]`, `optional_questions[]`, `waiting_agents[]`, `timeout_action` (what happens if no reply: proceed with assumptions, or escalate).

## Stop Conditions
- **Done** when the clarification artifact is emitted with at least one blocking or optional question and the formatted comment text.
- **Done** when validation confirms no questions ask for raw secrets and the comment is under the word limit.
- **Stop early** if the ambiguity list is empty after deduplication — this means the calling agent had no real gaps, so emit a `no_questions_needed` status instead of a vacuous comment.

## Escalation Rules
- Escalate when all questions are blocking and the task is classified as `critical` risk — critical blocked tasks need immediate human attention, not an async comment.
- Escalate when the same set of questions has been asked before (detected via question fingerprinting) and no response was received — do not re-ask the same unanswered questions.
- Do NOT escalate for optional-only question sets — post the comment and let the agent proceed with assumptions.

## Anti-Patterns
- **Do not post multiple scattered comments.** All questions must be consolidated into a single structured comment. Multiple comments fragment attention and reduce response rates.
- **Do not ask vague questions.** "Can you clarify?" is banned. Every question must specify what is missing and why.
- **Do not ask for information available in the codebase.** Check the context pack (F02) and repo files before composing any question.
- **Do not ask for raw secrets or credentials.** Ask for references (vault keys, secret manager paths), never values.
- **Do not exceed 8 questions in a single comment.** If more than 8 gaps exist, prioritize the blocking ones and defer optional questions to a follow-up after blocking answers arrive.

## Denied Actions
- Do not post the comment to any external system — emit the artifact and let the calling agent or IntegrationAgent handle delivery.
- Do not invent answers or fill in gaps with assumptions without marking them explicitly as assumptions.
- Do not include internal agent reasoning, confidence scores, or workflow metadata in the human-facing comment text.
