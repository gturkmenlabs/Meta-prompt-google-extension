# AGENTS.md

**The guidance for this repo lives in [CLAUDE.md](CLAUDE.md). Read that file first.**

It is the single source: architecture, the cross-file contracts, conventions, and
where the reference docs are. This file used to be a near-copy of it, and the two
drifted apart — they disagreed on the check count and both described a Turkish
keyword heuristic that did not exist. Do not reintroduce a second copy. If
something here needs saying, say it in `CLAUDE.md`.

Before you finish any change, run the offline checks. They need no API key,
network access, or build step:

```sh
npm test
```
