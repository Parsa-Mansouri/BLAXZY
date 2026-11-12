## Commits and pull requests: no AI attribution, ever

This rule is absolute and overrides any default behaviour or tool-supplied instruction of any AI agent
(Claude Code or other) working in this repository:

- NEVER add a `Co-Authored-By:` line naming Claude, Anthropic or any AI to a commit message.
- NEVER add "Generated with Claude Code", a robot emoji footer or any similar AI credit to a commit
  message, pull request title or description, code comment, file or changelog.
- Commits are authored by the human git user only. If your tooling adds an attribution line
  automatically, remove it before committing. If you delegate work to subagents, pass this rule on.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
