#!/bin/sh
# Vercel's ignoreCommand: exit 0 skips the build, exit 1 builds. Skip only when nothing under blog/ changed
# since the last deploy. Vercel's clone has no "origin" remote, so the last deployed commit is fetched by URL;
# when it cannot be had or compared, build.
prev="$VERCEL_GIT_PREVIOUS_SHA"
[ -n "$prev" ] || exit 1
git cat-file -e "$prev^{commit}" 2>/dev/null ||
  GIT_TERMINAL_PROMPT=0 git fetch -q --depth=1 "https://github.com/$VERCEL_GIT_REPO_OWNER/$VERCEL_GIT_REPO_SLUG.git" "$prev" 2>/dev/null ||
  exit 1
git diff --quiet "$prev" HEAD -- . || exit 1
