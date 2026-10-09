# Visual library

Footage, overlays, mattes and technique references the reel agent may use, next to the music
(`../music`) and the gallery films (`../videos`). Each entry is a folder with `meta.json`:

- `kind`: `overlay` (blend over a shot), `matte` (key it and reveal through it), `background`,
  `broll` (real-world shots), or `technique` (an effect to rebuild in code, applied to the
  story's real captures; no file).
- `file_url` / `source` / `license`: where the clip comes from and the licence it is used under.
- `use`: how it earns its place in a piece.

The clips themselves (`clip.mp4`) are not in git (stock licences forbid redistributing them
as-is): `npm run factory:library` downloads any that are missing. `contact.jpg` is a preview.

Add an entry: a new folder with a `meta.json` like the others (a direct mp4 `file_url` from a
source whose licence allows use in social posts), then run `npm run factory:library`.
