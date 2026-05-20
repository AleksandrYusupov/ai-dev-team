# Obsidian Documentation Protocol (Architecture-first)

This protocol assumes your system architecture documentation lives in an **Obsidian vault**.

The goal is to make every agentic code change:
- aligned with the documented architecture,
- reflected back into documentation,
- easy to audit later.

---

## 1) Before coding: “Architecture Discovery”

### 1.1 Locate the canonical docs
You must locate, at minimum:
- the architecture overview for the relevant system,
- the module/service boundaries for the area you will touch,
- any runbooks or operational constraints for that area,
- ownership/responsibility notes if they exist.

### 1.2 Extract constraints into the plan
From Obsidian, extract into your plan:
- invariants (“must always be true”),
- boundary contracts (APIs, schemas, events, DB tables),
- non-functional constraints (latency, rate limits, reliability),
- deployment assumptions and compatibility expectations.

### 1.3 Confirm docs match code reality
- If docs are missing or outdated, note it in the change log **before** coding.
- Prefer the smallest possible corrective doc update rather than “rewriting the whole doc”.

---

## 2) During coding: keep docs in sync mentally

### 2.1 Treat doc drift as a bug
If you discover:
- a mismatch between docs and code,
- an undocumented critical invariant,
- a hidden dependency,

then you must plan a doc update as part of the same change cycle.

### 2.2 Keep an “Architecture Notes” scratch section
While implementing, maintain a short bullet list:
- what assumptions were confirmed,
- what assumptions changed,
- what new behavior exists.

You can store this in your plan, in the change log, or in an Obsidian draft note.

---

## 3) After coding: required documentation updates

### 3.1 Minimum doc updates (must do)
Update at least one of these, as applicable:
- architecture overview page (if behavior or boundaries changed),
- module/service doc (if internals changed),
- runbook (if ops behavior changed),
- troubleshooting section (if new failure mode exists),
- ADR (if you made a meaningful decision/trade-off).

### 3.2 What “updated documentation” means
Docs must answer:
- what changed and why,
- what a developer should do next time,
- how to test/verify,
- how to roll back or migrate (if needed),
- known limitations.

### 3.3 Backlink hygiene (Obsidian-specific)
- Add backlinks from the changed module’s doc → relevant ADRs/runbooks.
- Link new docs from your “entry page” (the top-level map).
- Prefer stable note titles and avoid renaming pages unless necessary.

---

## 4) New note rules (required)

Whenever you create a new Obsidian note, you must do **both**:

### 4.1 Root-folder hashtag (required)
Add a hashtag that represents the **root directory** (top-level folder) where the note lives.

Examples:
- `Pal/.../My Note.md` → include `#pal`
- `thalia-1/.../My Note.md` → include `#thalia_1`
- `swarm_agent/.../My Note.md` → include `#swarm_agent`

**Normalization rule (required):**
- lower-case the folder name
- replace `-` with `_`
- replace spaces with `_`
- collapse repeated `_`
- keep it simple; do not invent a different taxonomy

**Where to place it:**
- simplest option: put it on its own line directly under the title:
  - `# <Title>`
  - `#<root_tag>`

If a note is at the vault root (no folder), use `#vault_root`.

### 4.2 Logical links with `[[double brackets]]` (required)
New notes must be connected into the knowledge graph.

Minimum standard:
- Add a `## Links` section that includes:
  - one parent/index note link (if one exists),
  - 2–5 related notes,
  - any key component/system notes referenced by the content.

Additionally:
- When you reference an existing concept that has a note, link it inline with `[[...]]`.
- Update at least one existing note to link back to the new note (bidirectional graph growth).

---

## 5) Documentation review checklist (quick)

- [ ] The doc reflects the new behavior accurately.
- [ ] The doc references the actual file/module names used in the code.
- [ ] Examples/commands are runnable.
- [ ] The doc notes any new constraints, invariants, or migration steps.
- [ ] The doc does not include secrets.
- [ ] New note (if created) has:
  - [ ] root-folder hashtag,
  - [ ] `[[...]]` links,
  - [ ] at least one backlink from an existing note.

---

## 6) How to record doc updates

In `04_AGENT_CHANGELOG.md`, record:
- the Obsidian page paths/links updated,
- a one-line summary of what changed in docs,
- any doc debt you chose not to address (with reason).
