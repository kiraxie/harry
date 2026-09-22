---
name: wait-what
description: Re-explain the previous message once, in plainer words. Use when the user says "wait, what?" or otherwise signals they could not parse the last message. One-shot — not a mode, does not persist.
---

# Wait, what?

**Plugin root.** Codex does not set `${CLAUDE_PLUGIN_ROOT}`, so resolve it before
anything else: take the absolute path this `SKILL.md` was loaded from and cut the
trailing `codex-skills/wait-what/SKILL.md` and the slash before it — what is left is the plugin root, the directory
that holds `codex-skills/`, `dist/` and `references/`. Use that absolute path wherever
`${CLAUDE_PLUGIN_ROOT}` appears below and in the files this skill points you to.

The reader hit your previous message and could not parse it. Read
`${CLAUDE_PLUGIN_ROOT}/references/plain-language.md` and follow its deeper level —
once, on that one message only. This is not a mode and does not persist: it changes
nothing about how later messages are written.
