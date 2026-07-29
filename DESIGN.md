# Dr. Ahmed Attia Drar — Design System Spec

Portable design specification for AI design tools (Google Stitch, v0, Lovable, Figma AI), **webpages**, and **PowerPoint / slide decks**.
Paste this file into the tool's design/system instructions to reproduce the brand. Medium-specific rules are in §10 (web) and §11 (slides).

**Brand character:** Academic authority, engineering precision, professional credibility. Restrained navy-and-gold palette, serif display face, clean sans body. Editorial, formal, minimal — never flashy.

---

## 1. Color Palette

### Core colors
| Role | Name | Hex |
|------|------|-----|
| Primary dark (hero bg, nav, footer) | Navy 900 | `#0e2238` |
| Dark section gradient end | Navy 800 | `#14304d` |
| Mid-dark accent | Navy 700 | `#1b3f63` |
| Primary accent (kickers, tags, buttons) | Gold 600 | `#c9a227` |
| Light accent (hero headings, hovers) | Gold 400 | `#e3c563` |
| Body text | Ink | `#22303e` |
| Secondary text | Muted | `#5d6b79` |
| Light section background | Paper | `#f7f8fa` |
| White | White | `#ffffff` |
| Borders / dividers | Line | `#e3e8ee` |

### Text on dark (navy) surfaces
| Role | Hex |
|------|-----|
| Headings | `#eef2f6` |
| Body | `#b9c6d4` |
| Dim labels | `#aebccb` |
| Muted / footer | `#9fb1c2` |
| Org / institution labels | `#8fa6bc` |

### Usage rules
- Two-color brand: **deep navy + warm gold**, neutrals for body. Never introduce other hues.
- **Sections alternate** light (white / `#f7f8fa`) and dark (navy). Dark sections use `linear-gradient(180deg, #0e2238 0%, #14304d 100%)` — never flat navy, never imagery.
- Gold is an accent only — never a background fill for large areas.
- Borders on dark: `rgba(255,255,255,.08)` (subtle) or `rgba(255,255,255,.14)` (mid).
- Hero overlay: directional gradient at `100deg`, `rgba(10,26,44,0.95)` → `rgba(10,26,44,0.55)` (dark left, lighter right) over a wide photo.

---

## 2. Typography

- **Display / headings:** Fraunces (Google Fonts, variable `opsz`), weights 500 / 600 / 700. Fallback: Georgia, serif.
- **Body / UI:** Inter (Google Fonts), weights 400 / 500 / 600 / 700. Fallback: system sans.

### Type scale
| Token | Size | Use |
|-------|------|-----|
| 2xs | 0.72rem | tags, year labels |
| xs | 0.78rem | kickers, badges, nav links |
| sm | 0.82rem | meta labels, footer |
| base | 0.90rem | card descriptions |
| md | 0.95rem | buttons, citations |
| lg | 1.00rem | base body |
| xl | 1.05rem | section lead / intro |
| 2xl | 1.08rem | card h3, timeline h4 |
| 3xl | 1.15rem | brand name |
| h2 | clamp(1.7rem, 3.4vw, 2.4rem) | section headings |
| hero h1 | clamp(2.4rem, 6vw, 4.2rem) | hero |
| page h1 | clamp(2rem, 5vw, 3.2rem) | sub-pages |
| stat | 2.1rem | hero stat numbers (Fraunces) |

### Rules
- Line heights: headings `1.15`, card titles `1.30`, body `1.65`, long prose `1.70`.
- **Kicker labels** (section eyebrows): Inter, `0.78rem`, ALL CAPS, `letter-spacing: 0.22em`, weight 700, color gold `#c9a227`.
- Letter spacing: tags `0.12em`, year labels `0.08em`, buttons `0.01em`.
- Headings: navy `#0e2238` on light, white `#eef2f6` on dark.

---

## 3. Spacing, Layout & Radius

- Spacing scale (px): 4, 8, 12, 14, 16, 18, 22, 24, 28, 32, 40, 48, 56, 64, 80.
- Container: `min(1140px, 92%)`, centered. Nav height: `64px`. Section vertical padding: `clamp(64px, 9vw, 110px)`.
- Grid gaps: chips 9px · hero actions 14px · stats/contact 18px · cards 22px · project grid 24px · two-column splits 56px.
- Radii: main cards `14px` · internal blocks `10–12px` · small `6–8px` · buttons/chips/badges `999px` (pill) · dots `50%`.
- Card padding: `28px 26px` (large), `22px 24px` (medium), `18px 20px` (small).

---

## 4. Shadows & Elevation

- Card (hover): `0 10px 30px rgba(14,34,56,.10)` — cool-toned, matches navy.
- Gold button glow: `0 6px 20px rgba(201,162,39,.35)`.
- Nav: `0 2px 8px rgba(14,34,56,.08)`.
- Modal: `0 8px 30px rgba(0,0,0,.30)`.
- Timeline node ring: `0 0 0 4px rgba(201,162,39,.22)`.
- **No inset shadows. No colored shadows except the gold button glow.**

---

## 5. Components

### Buttons (all pill-shaped, `border-radius: 999px`, padding `13px 30px`)
- **Gold (primary):** bg `#c9a227`, text `#0e2238`. Hover: lift `translateY(-2px)` + gold glow shadow.
- **Ghost (on dark):** transparent, `1.5px solid rgba(255,255,255,.45)`, white text → gold text on hover.
- **Navy:** solid `#0e2238`, white text (download actions).
- No press/active shrink; hover lift only.

### Cards
- Light: white bg, `1px solid #e3e8ee`, radius `14px`, padding `28px`.
- Dark: `rgba(255,255,255,.05)` bg, `1px solid rgba(255,255,255,.1)`.
- Hover: `translateY(-4px)` + card shadow, transition `transform .25s, box-shadow .25s`.
- Optional gold left-border accent: `border-left: 3px solid #c9a227` (reference cards), or a 3px gold left bar revealed on hover.

### Navigation
- Fixed top, full-width. Bg `rgba(14,34,56,0.92)` + `backdrop-filter: blur(10px)` (frosted glass — the only blur in the system).
- Bottom border `1px solid rgba(255,255,255,.08)`.
- Links `#d4dde6`, hover `#e3c563`. Brand name in Fraunces with gold surname.
- Contact CTA rendered as a gold pill inline with links.

### Badges / Chips / Kickers
- Pill shape, small caps text with wide tracking, gold or navy tinted.
- Section kicker = uppercase gold label above every section heading.

### Timeline
- 2px vertical line `rgba(201,162,39,.35)`, gold circular dots with `0 0 0 4px rgba(201,162,39,.22)` ring.

---

## 6. Motion

- **Scroll reveal:** elements enter `opacity 0→1` + `translateY(24px)→0`, `0.7s ease`, IntersectionObserver threshold 0.12.
- **Stat counters:** count up from 0 on view, cubic ease-out, 1400ms.
- Hover transitions: `0.2–0.25s` ease.
- **No looping animations, no parallax, no page transitions.**

---

## 7. Iconography & Imagery

- Icons: stroke-based outline SVGs — `stroke-width: 2`, round caps/joins (Feather/Lucide style). No filled icons, no icon fonts.
- Emoji used sparingly as category anchors inside light rounded containers (1.5–1.7rem) — never in prose, headings, or nav.
- Photography: real project photos (aerial, site, lab), warm-neutral temperature. Formal headshot for portrait. **No illustrations, no decorative SVGs, no stock-photo look.**

---

## 8. Voice & Content

- Formal, third person ("Dr. Drar", never "I"). Precise and factual; no hyperbole.
- Kickers ALL CAPS (`ABOUT`, `CAREER`); headings sentence case with Title Case proper nouns.
- Em dash (—) for rhetorical pauses; middle dot (·) for metadata separators; `&` over "and" in tight headings.
- Stats use `+` suffix when approximate (`17+`, `200+`); date ranges use en dash (`2013 – 2016`).

---

## 9. CSS Token Block (copy-paste)

```css
:root {
  --color-navy-900:#0e2238; --color-navy-800:#14304d; --color-navy-700:#1b3f63;
  --color-gold-600:#c9a227; --color-gold-400:#e3c563;
  --color-ink:#22303e; --color-muted:#5d6b79; --color-paper:#f7f8fa;
  --color-white:#ffffff; --color-line:#e3e8ee;
  --color-on-dark-strong:#eef2f6; --color-on-dark-body:#b9c6d4;
  --font-head:"Fraunces",Georgia,serif;
  --font-body:"Inter",-apple-system,"Segoe UI",system-ui,sans-serif;
  --radius-card:14px; --radius-pill:999px;
  --shadow-card:0 10px 30px rgba(14,34,56,.10);
  --shadow-btn-gold:0 6px 20px rgba(201,162,39,.35);
  --container-max:1140px; --section-y:clamp(64px,9vw,110px);
  --grad-dark:linear-gradient(180deg,#0e2238 0%,#14304d 100%);
}
```

Google Fonts import:
```
https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap
```

---

## 10. Webpage Recipe

- Page structure: fixed frosted navy nav → full-viewport hero (photo + 100deg dark overlay, text left) → alternating light/dark sections → light contact section → navy footer.
- Every section: gold ALL-CAPS kicker → Fraunces h2 → optional intro line → content grid.
- Content in a centered `min(1140px, 92%)` container; section padding `clamp(64px, 9vw, 110px)` vertical.
- Cards in responsive grids (`repeat(auto-fit, minmax(280px, 1fr))`, gap 22–24px), hover lift `-4px` + shadow.
- Scroll-reveal entrance (opacity + 24px rise, 0.7s) on cards and grid items; nothing loops.
- Links: gold-tinted underline `border-bottom: 1px solid rgba(201,162,39,.5)`; hover text `#c9a227`.

---

## 11. PowerPoint / Slide Deck Recipe (16:9, 1920×1080)

### Slide backgrounds — 2 only
- **Light slides (default):** white `#ffffff` or paper `#f7f8fa`.
- **Dark slides (title, section dividers, closing):** vertical navy gradient `#0e2238 → #14304d`; if gradients unavailable, flat `#0e2238`.

### Slide layouts
- **Title slide (dark):** gold kicker top-left → Fraunces title in `#eef2f6` (~80–96px) → subtitle in `#b9c6d4` → thin gold rule or middle-dot metadata line.
- **Section divider (dark):** oversized section number in gold at low opacity, Fraunces section title, kicker above.
- **Content slide (light):** kicker + Fraunces h2 (~48–56px, navy) top-left; body content below in Inter.
- **Stat slide:** 3–4 stats in a row — Fraunces number (~96px, gold or navy) over Inter ALL-CAPS label (~24px, letter-spaced).
- **Image slide:** full-bleed photo with left navy overlay gradient, text on left third in white.

### Slide type scale (min 24px anywhere)
| Element | Font | Size | Color |
|---------|------|------|-------|
| Kicker | Inter Bold, ALL CAPS, wide tracking | 24–28px | `#c9a227` |
| Slide title | Fraunces SemiBold | 56–72px | navy / `#eef2f6` |
| Deck title | Fraunces Bold | 80–96px | `#eef2f6` |
| Body | Inter Regular | 28–32px | `#22303e` / `#b9c6d4` |
| Captions/meta | Inter Medium | 24px | `#5d6b79` / `#9fb1c2` |
| Stat number | Fraunces Bold | 88–120px | `#c9a227` |

### Slide rules
- Margins ≥ 96px on all sides; align content to a consistent left edge.
- Cards on slides: white (or `rgba(255,255,255,.05)` on dark), 14px corner radius, 1px border — no heavy shadows in decks.
- Gold used only for kickers, stats, rules, and accent dots — never large fills.
- Fonts to install for PowerPoint: **Fraunces** and **Inter** (both free on Google Fonts). Fallbacks: Georgia / Calibri.
- No clip art, no emoji in slide prose, no more than 2 background colors across the deck.
