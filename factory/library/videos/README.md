# Opus video library

Drop each of your Opus-made videos here as one folder:

```
videos/<slug>/
  meta.json      # required
  prompt.md      # the prompt that produced it (required: this is what hero mode learns from)
  video.mp4      # optional, for humans; not read by the pipeline
  src/           # optional: the code Opus wrote (Remotion / HTML / three.js)
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
- **Hero mode** (`src/factory/hero.js`): the agent gets the 2 closest entries' `prompt.md` (and `src/`
  if present) as references before it writes a bespoke film.

`score` (1-5) is yours to set after a piece has been live for a week; higher scores win ties.
