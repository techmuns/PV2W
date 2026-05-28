---
name: git-commit-summarizer
description: Summarize the currently staged git diff as a conventional commit message and flag risky changes. Use when the user asks to write a commit message, describe staged changes, or review what is about to be committed.
---

# git-commit-summarizer

When invoked:

1. Run `git diff --cached --stat` to see scope, then `git diff --cached` for content.
2. If nothing is staged, tell the user and stop. Do not stage anything for them.
3. Produce a Conventional Commits message:
   - Subject: `<type>(<scope>): <summary>` — keep under 72 chars.
   - Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `build`, `ci`.
   - Body (optional): 1–3 bullets explaining *why*, not what. Skip if the subject already says it.
4. **Risk flags** — call these out under a `## Risks` heading if any apply:
   - Secret-shaped strings (API keys, tokens, private keys, raw `.env` lines).
   - Deletions of more than ~50 lines in a single file.
   - Changes to migrations, auth, payments, cryptography, or CI config.
   - Lockfile changes without a matching manifest change (or vice versa).
   - Large binary blobs or files over a few hundred KB.
5. Output only the proposed message and the risks block. Do not run `git commit`.

Format the response so the user can copy the subject + body straight into `git commit -m`.
