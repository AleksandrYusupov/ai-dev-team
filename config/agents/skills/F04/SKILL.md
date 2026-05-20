# F04 — Git Hygiene & Branch Safety

## Summary
- Category: `foundation`
- Availability: `custom`
- Kind: `foundation`
- Reference-only default: `false`
- Sensitivity class: `standard`
- Description: Следит за чистым git status, scoped diffs, feature branches, worktree/branch naming, small commits, revertability и связкой issue↔branch↔PR.
- Why: Нужен всем агентам, которые пишут код или готовят PR. Без гигиены git автономная работа агентов создаёт неревертируемый хаос.

## When To Use
- **Mandatory** before any commit, branch creation, or PR preparation — агент не должен пропускать этот скилл при работе с git.
- When an agent starts work on a new task — проверить, что worktree чистый и ветка правильно названа.
- When preparing a commit — убедиться, что diff scoped, коммит атомарный, и issue/PR привязаны.
- When switching between tasks or branches — валидировать, что нет uncommitted changes и stale state.
- Do NOT use for read-only operations (git log, git blame, git show) — этот скилл только для мутирующих git-действий.

## Inputs
- Current working directory path и target repository.
- Task context: issue ID, expected branch name pattern, target base branch.
- Diff payload: staged changes, unstaged changes, untracked files.
- Branch protection rules из repo config (если доступны).
- Commit message draft (если агент уже подготовил).

## Steps
1. **Check worktree cleanliness** — выполнить `git status` и проанализировать результат:
   - Если есть uncommitted changes, не относящиеся к текущей задаче — **STOP**, эскалировать.
   - Если есть untracked files — классифицировать: generated (игнорировать), relevant (добавить в .gitignore или stage), unknown (эскалировать).
   - Допускается dirty tree только при явном флаге `allow_dirty: true` в task contract.

2. **Validate branch naming** — проверить, что текущая ветка соответствует конвенции:
   - Pattern: `{type}/{issue-id}-{short-description}` (например `feat/ABC-123-add-oauth`).
   - Запрещено работать напрямую на `main`, `master`, `develop` без явного разрешения.
   - Если ветка не существует — создать с правильным именем от актуального base branch.

3. **Scope the diff** — перед каждым коммитом проверить, что изменения не выходят за scope задачи:
   - Сравнить список изменённых файлов с ожидаемыми из task contract (affected paths, modules).
   - Если diff содержит файлы вне scope — вынести их в отдельный коммит или эскалировать.
   - Запрещено коммитить formatting-only changes вместе с logic changes.

4. **Enforce small atomic commits** — каждый коммит должен быть:
   - Логически атомарным: одна идея = один коммит.
   - Revertable без побочных эффектов на другие функции.
   - С commit message по формату: `{type}({scope}): {description}` + ссылка на issue.
   - Максимум ~300 строк diff на коммит (soft limit); если больше — разбить.

5. **Link issue, branch, PR** — обеспечить трассируемость:
   - Commit message содержит issue ID (например `Refs: ABC-123`).
   - Branch name содержит issue ID.
   - При создании PR — body содержит `Closes ABC-123` или `Refs ABC-123`.
   - Проверить, что issue status обновлён (если есть доступ к Linear API).

6. **Respect branch protection** — перед push проверить:
   - Не push --force на protected branches.
   - Не прямой push на main/master — только через PR.
   - Required reviewers и checks должны быть учтены в PR description.

7. **Final pre-push validation** — финальная проверка перед отправкой:
   - `git diff --stat` для подтверждения scope.
   - `git log --oneline base..HEAD` для подтверждения commit history.
   - Нет merge commits (rebase preferred, если это policy репо).

## Stop Conditions
- **Done** when all commits are scoped, named correctly, linked to issue, and pushed to a correctly named feature branch.
- **Done early** if worktree was already clean, branch correct, and no git mutations needed (read-only task).
- **Never skip** branch naming and scope validation — даже для "quick fixes".

## Escalation Rules
- Escalate when worktree contains uncommitted changes from another task that cannot be safely stashed.
- Escalate when diff scope exceeds task boundaries and agent cannot determine safe split point.
- Escalate when branch protection prevents the required operation (force push needed, reviewer missing).
- Escalate when merge conflicts require human judgement on business logic.
- Do NOT escalate for routine branch creation, clean commits, or standard PR linking.

## Anti-Patterns
- **Do not combine unrelated changes in one commit** — "fix everything" commits destroy revertability.
- **Do not work on main/master directly** — даже для single-line fixes, используй feature branch.
- **Do not force-push without explicit approval** — это уничтожает чужую историю.
- **Do not ignore .gitignore** — generated files, secrets, build artifacts не должны попадать в diff.
- **Do not treat commit messages as optional** — каждый коммит должен быть self-documenting.

## Denied Actions
- Do not execute `git push --force` or `git reset --hard` without explicit human approval.
- Do not commit files matching `.env`, `credentials.*`, `*.key`, `*.pem` patterns.
- Do not delete remote branches that are not owned by the current task.
- Do not rewrite history on shared branches (rebase on branches with other contributors).
- Do not bypass pre-commit hooks with `--no-verify`.
