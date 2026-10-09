# Reference library

Every film the agent learns from, one folder each: the motionpromptgallery.com (`mpg-*`) and
prompt-motion.com (`pm-*`) galleries, the two reference repos, and your own pieces:

```
videos/<slug>/
  meta.json      # required
  prompt.md      # the full prompt, verbatim (required: this is what the agent learns from)
  contact.jpg    # 3x3 frames across the film, so the agent can see it
  video.mp4      # optional (gitignored); the agent can pull extra frames with ffmpeg
  src/           # optional: the code (Remotion / HTML / three.js)
```

`meta.json`:

```json
{
  "title": "Tessel launch film",
  "formats": ["reel"],
  "tags": ["launch", "product", "ui"],
  "score": 5,
  "why": "One continuous relay object (the red dot) carried through every cut; beat-locked SFX from the same timeline."
}
```

How the pipeline uses it:

- **Template mode** (`src/factory/storyboard.js`): the `why` lines of the best-scoring entries whose
  tags match the article are added to the storyboard prompt as proven patterns, next to `../patterns.json`.
- **Agent films** (`src/factory/hero.js`): the agent gets a catalog of EVERY entry with its file paths,
  the full `prompt.md` of the 3 closest, and read access to this whole folder plus `../repos/`
  (clones of every `repo` URL; `npm run factory:library`).

`score` (1-5) is yours to set after a piece has been live for a week; higher scores win ties.
