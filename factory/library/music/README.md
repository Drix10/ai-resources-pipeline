# Music library

The only music reels use. One folder per mood; files named `Title - Artist.mp3` (m4a, wav, flac,
ogg and aac work too):

- `educational/`: explainers, how-it-works, guides
- `emotional/`: stakes, loss, risk, warnings
- `inspirational/`: launches, records, breakthroughs
- `storytelling/`: narratives and everything else

`catalog.json` is written by `src/factory/music.js`: tempo and beat grid, loudness, energy per
second and the drops of every track. A new or changed file is analysed the next time a reel is
made (or run `npm run factory:library`). Hand-edit `vocals`, `exclude`, `tags` or `notes` there;
they survive re-analysis.

How a reel uses it: the director picks a track from the list (or the code picks the best fit for
the story's mood that was not used in the last 8 pieces, instrumentals first under a voice). The
track's biggest drop is placed on the film's climax, the window starts on a downbeat, and the
agent gets the real beats to cut on. In the mix the music steps down under the voice (deeper for
tracks with vocals) and comes back up in every pause; sound effects are synthesized on the
agent's cues; the result is mastered to -14 LUFS.

The audio files are not in git (commercial recordings are never published from this repo):
copy the folder to a new machine by hand. The catalog and folder layout are versioned.
