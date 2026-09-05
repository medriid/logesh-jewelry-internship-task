# Brand

Open [`brand-sheet.html`](brand-sheet.html) in a browser for the visual system.
Source files live in [`../public/brand/`](../public/brand/).

## The name

A **loupe** is the jeweller's 10× lens — the one tool in the trade whose entire
purpose is verification. You hand someone a loupe when you have nothing to hide.

That is the argument this codebase makes. Net weight versus gross weight, the
making charge, the day's gold rate, the BIS hallmark number: all of it is public
API surface rather than something hidden behind a sticker price. The name and the
[pricing architecture](adr/0006-price-is-a-computation.md) say the same thing.

It also reads as _loop_ — a chain, a ring.

## The mark

The lens **is** the O in LOUPE. Not a logo placed beside a name; a letter inside
it, so the mark and the wordmark cannot drift apart.

Two rings: the bezel, and a lighter one set inboard for the glass. That inner
ring is the whole difference between a loupe and a wedding band. The polish comes
from the bezel's own gradient, sweeping champagne to bronze around the
circumference — contrast internal to the shape, so it holds on parchment and on
ink alike. (A pale highlight arc was tried first. It vanished on white.)

| File                            | Use                                                       |
| ------------------------------- | --------------------------------------------------------- |
| `mark.svg`                      | Primary. Gold gradient.                                   |
| `mark-mono.svg`                 | Inherits `currentColor` — foil, emboss, dark grounds.     |
| `wordmark.svg` / `-inverse.svg` | Horizontal lockup, light and dark.                        |
| `lockup-stacked.svg`            | Mark over wordmark with tagline. Packaging, certificates. |
| `icon.svg`                      | Favicon and app icon.                                     |

`icon.svg` is deliberately **not** the mark reduced. At 16px the inner ring and
the gradient collapse into mud, so it is redrawn as one heavy ring on an ink
tile — still legibly a lens, at a size where the real mark is not.

In the wordmark the O's bezel is **ink**, matching the stem weight and colour of
L·U·P·E, with gold reduced to the inner ring. A fully gold O reads as a hole in
the word rather than a letter.

## Palette

|           | Hex                                      | Use                                 |
| --------- | ---------------------------------------- | ----------------------------------- |
| Gold      | `#B08D3F` → gradient `#F7E9C4 … #5E4415` | Mark, rules, prices, active states  |
| Champagne | `#E7D3A1`                                | Highlights, hover, text on dark     |
| Ink       | `#16130F`                                | Body copy, buttons, inverse grounds |
| Parchment | `#FAF8F4`                                | Page ground — never pure white      |

Warm near-black, not `#000`: a true black beside gold looks like a spreadsheet.

## Type

**Cormorant Garamond** for anything the customer feels — product names, prices,
headings. **Inter** for anything they must read precisely — specs, forms, tables.

Numerals are always tabular. A catalog where `₹1,04,857` and `₹98,200` fail to
align down a column looks careless about numbers, which is the last thing a
jeweller can afford to look.

## Changing any of it

`name`, `legalName`, `tagline`, palette and fonts all live in
[`src/config/brand.ts`](../src/config/brand.ts), mirrored for CSS in
[`src/app/globals.css`](../src/app/globals.css). No brand string is hard-coded
anywhere else. Renaming the brand is a two-line change plus new SVGs.
