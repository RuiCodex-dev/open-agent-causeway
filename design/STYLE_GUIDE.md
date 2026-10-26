# Causeway style guide

One visual system for the web UI, the deck and the demo video.

## Palette
| Token | Hex | Use |
|---|---|---|
| paper | `#f6f3ec` | page background |
| ink | `#1c1f24` | text, rules on dark slides |
| rule | `#d8d2c4` | hairlines, borders |
| muted | `#6b6f76` | captions, secondary text |
| signal | `#1f5fbf` | kickers, links, model-proposes |
| support | `#2f7a4f` | supported verdicts, code-decides |
| refute | `#b4442e` | contradicted verdicts, veto loops, honest caveats |
| night | `#14161a` | cover and closing slides, video title cards |

## Type
- Headlines: **Source Serif 4** (600/700).
- Body and UI: **IBM Plex Sans** (400/500/600).
- Labels, code, captions: **IBM Plex Mono** (400/500), uppercase with letter spacing for kickers.
- All OFL 1.1, self-hosted (`deck/fonts`, `@fontsource` in the UI).

## Imagery
- Only real captures of the running system (Causeway UI, Zetaris UI, Nightshift window). No generated imagery,
  no mocked screens. Captions say what each capture shows and from which mode (live, snapshot).
- Diagrams are drawn in code (SVG) in the palette above.

## Motion (video)
- Calm, editorial: fades and slow pushes on real captures, kinetic type for section titles; no glitch or glow effects.
- Speed-ups of real waits are labelled on screen (e.g. "×4").
