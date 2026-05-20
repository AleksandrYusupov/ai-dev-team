# S48 — Credential Prerequisite Handshake Manager

## Summary
- Category: `custom`
- Availability: `custom`
- Kind: `custom`
- Reference-only default: `false`
- Sensitivity class: `credential_boundary`
- Description: Manages the structured Needs Input flow for credential prerequisites. Asks human to perform console actions (register OAuth app, approve scopes, complete browser consent, confirm secret slot populated) via structured comments — never asks for raw credential paste.
- Why: The most frequent integration failure is not code but a broken handshake between the system and the human. This skill enforces a safe, structured protocol for that handshake.

## When To Use
- When S47 has identified human-gated actions (OAuth app registration, scope approval, consent flow) that block the integration lifecycle.
- When IntegrationAgent (A21) needs to request credential prerequisites from a human operator without exposing raw secrets.
- When OrchestratorAgent (A00) detects an unresolved `needs:*` prerequisite that holds an issue out of Ready for Build.
- Do NOT use for requesting information that is not credential-related — use standard Needs Input flows for non-auth prerequisites.

## Inputs
- `human_gated_actions` list from the S47 auth_decision_record.
- Credential slot definitions: which slots in the credential store need to be populated.
- Provider vendor console URLs (documentation links, not authenticated sessions).
- Current prerequisite status: which items are already resolved, which are still blocking.

## Steps

1. **Inventory missing prerequisites** — scan the auth_decision_record and credential store metadata:
   - List each unresolved prerequisite with its type: `oauth_app_registration`, `scope_approval`, `browser_consent`, `secret_slot_population`, `webhook_url_registration`, `redirect_uri_registration`.
   - For each, determine: `what_missing`, `why_needed`, `blocking` (true/false).

2. **Compose structured handshake request** — for each missing prerequisite, produce:
   - `what_missing`: plain-language description of what is needed.
   - `why_needed`: how this prerequisite connects to the integration lifecycle.
   - `exact_console_action`: step-by-step instructions the human should follow in the vendor console.
   - `accepted_answer_shape`: what the human should reply with (e.g., "Confirm that client_id slot is populated", NOT "Paste the client_id here").
   - `secure_upload_path`: where the human should store raw credentials (credential store, not Linear/chat).
   - `blocking_flag`: whether this prerequisite blocks the issue from entering Ready for Build.
   - `post_response_resume_rule`: what the system does once the human confirms completion.

3. **Post structured comment** — deliver the handshake request to the human:
   - Post as a structured Linear comment or designated handoff surface.
   - Tag the issue with `needs:credential_prerequisite` and set status to Needs Input.
   - Include vendor console documentation links (public URLs only, no session links).

4. **Validate human response** — when the human responds:
   - Verify the response matches the `accepted_answer_shape` (confirmation, not raw paste).
   - If the human accidentally pastes raw credentials, **reject the response**, request deletion of the comment, and re-prompt with the correct answer shape.
   - Check credential store metadata to confirm the slot is now populated (by alias, not by value).

5. **Update prerequisite status** — for each resolved prerequisite:
   - Mark as resolved in the tracking record.
   - Remove the `needs:*` tag if all prerequisites are cleared.
   - Transition the issue toward Ready for Build if all blocking prerequisites are resolved.

6. **Emit outputs** — deliver `prerequisite_status_report`, `resolved_items`, `still_blocking_items`, and updated Linear issue state.

## Stop Conditions
- **Done** when all blocking prerequisites are resolved and confirmed via credential store metadata.
- **Waiting** when structured handshake requests have been posted and human responses are pending.
- **Blocked** when a human response contains raw credentials — reject, request cleanup, and re-prompt.
- **Escalate** when a prerequisite remains unresolved beyond the configured SLA threshold.

## Escalation Rules
- Escalate when a human pastes raw credentials despite the structured prompt — this is a security incident.
- Escalate when prerequisite requests remain unanswered beyond the SLA threshold.
- Escalate when the vendor console action is ambiguous and the human requests clarification the skill cannot provide.
- Do NOT escalate for routine handshake cycles — waiting for human action is expected behavior.

## Anti-Patterns
- Do not duplicate always-on repo guidance inside this selective skill.
- Do not silently widen the owning role scope.
- **Do not ask humans to paste raw credentials.** Always direct them to the credential store's secure upload path.
- Do not accept raw secrets, tokens, or keys in Linear comments, chat messages, or any non-auth-plane surface.
- Do not skip the validation step when a human responds — always verify the answer shape.
- Do not treat "I did it" as sufficient confirmation — verify credential store metadata shows the slot populated.

## Denied Actions
- Do not request, paste, persist, or summarize raw secrets, tokens, browser session dumps, or vendor-console exports.
- Do not move credential truth into prompt bundles, context packs, repo docs, or Linear comments.
- Do not collapse the metadata plane and credential plane into one artifact or one instruction surface.
- Do not accept or store raw credentials even temporarily — if received, reject and request deletion immediately.
