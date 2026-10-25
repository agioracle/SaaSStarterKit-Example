---
name: "Lumina"
description: "A private image proof bench with a visible recipe and truthful lifecycle."
colors:
  bg: "#eeede9"
  surface: "#fbfbf8"
  ink: "#302735"
  muted: "#69616e"
  line: "#d5d1d7"
  soft: "#e7e4e9"
  accent: "#4b3656"
  accent-soft: "#e9dfed"
  danger: "#a1313f"
  control-line: "#8a818e"
  selection: "#e4bb70"
  selection-ink: "#322839"
  focus: "#835a19"
  dark-bg: "#231e28"
  dark-surface: "#2e2734"
  dark-ink: "#f1ebf2"
  dark-muted: "#c2b8c7"
  dark-line: "#514757"
  dark-soft: "#39313f"
  dark-accent: "#dcc5e8"
  dark-accent-soft: "#4b3d56"
  dark-danger: "#ffb6bb"
  dark-control-line: "#95849f"
  dark-selection: "#d5ad67"
  dark-selection-ink: "#271e2b"
  dark-focus: "#e6bf7e"
typography:
  display:
    fontFamily: "\"Hanken Grotesk\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "clamp(3rem, 5.4vw, 5.6rem)"
    fontWeight: 650
    lineHeight: 1.02
    letterSpacing: "-0.04em"
  display-zh:
    fontFamily: "\"Hanken Grotesk\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "clamp(2.8rem, 4.8vw, 4.8rem)"
    lineHeight: 1.18
  headline:
    fontFamily: "\"Hanken Grotesk\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "2.4rem"
    fontWeight: 600
    lineHeight: 1.16
    letterSpacing: "-0.025em"
  page-title:
    fontFamily: "\"Hanken Grotesk\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  panel-title:
    fontFamily: "\"Hanken Grotesk\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "1rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0"
  body:
    fontFamily: "\"Hanken Grotesk\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "1rem"
    lineHeight: 1.7
  field-label:
    fontFamily: "\"Hanken Grotesk\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "0.86rem"
    fontWeight: 600
  button:
    fontFamily: "\"Hanken Grotesk\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "0.9rem"
    fontWeight: 650
    lineHeight: 1.3
rounded:
  badge: "4px"
  choice: "6px"
  control: "8px"
  panel: "12px"
spacing:
  tight: "6px"
  compact: "8px"
  inline: "12px"
  inset-small: "16px"
  inset: "20px"
  group: "24px"
  bench-gap: "28px"
  section: "32px"
  workspace-gutter: "36px"
  room: "48px"
  public-section: "72px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.soft}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
    height: "44px"
  prompt-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px"
    height: "132px"
  navigation-link:
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "12px"
    height: "44px"
  navigation-link-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
  style-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.choice}"
    padding: "8px 10px"
    height: "40px"
  style-chip-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.selection-ink}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
  proof-canvas:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
  allowance:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "16px 20px"
---

# Design System: Lumina

## Overview

**Creative North Star: "印样工作台 — Printmaker proof bench"**

Lumina is a modern, simple and warm proof bench for private image creation. Mineral grey grounds, aubergine ink and a small amount of ochre make the recipe, the image and the real task state the focus. One humanist sans family serves both public pages and the working application; Chinese uses the platform fallback in the same stack.

Operate surfaces keep the Studio, library, detail and account tasks compact and readable. Home and pricing use more open space and larger type to persuade through an honest demonstration. The visual system is flat: thin dividers and changes in surface tone organize work. The reusable signature is a recipe beside an inspection canvas, with submission moving focus to the actual result or status region.

**Key Characteristics:**
- Task first: recipe, proof and lifecycle remain legible.
- Flat mineral surfaces with aubergine actions and ochre selection.
- One self-hosted humanist sans family, with EN/ZH and two themes.
- Original geometric vector studies are explicitly distinguished from model output.

This is a code-derived record of the completed local visual replacement. Sources are `src/styles.css` (the proof-bench override block and its surviving base rules), `src/components/lumina/`, `src/components/ui/core.tsx`, `src/components/layout/sidebar-navigation.css`, auth/account components and the root/workspace routes. The direction contract supplies the user-confirmed metaphor; implementation values come from source. `docs/product.md` supplies lifecycle constraints. The initial finish verdict covers three scored fixes and 15 recaptured views, and the separate shared-field focus verdict covers one additional fix and eight valid captures; both ship dispositions apply only to those scored fixes and do not certify every surface or live service behavior.

## Colors

The palette combines mineral neutrals with aubergine ink and action, and a restrained ochre selection signal. Frontmatter holds the exact values; token names below refer to that normative table. Each `dark-` entry is the corresponding dark-theme override of the same CSS variable.

### Primary

- **Aubergine** (`accent`, `dark-accent`): primary actions, links, carets, native accent controls and succeeded states. Its dark counterpart is a light aubergine so the same relationships remain readable.
- **Aubergine wash** (`accent-soft`, `dark-accent-soft`): active navigation, selected library filters and success notices.

### Secondary

- **Ochre** (`selection`, `dark-selection`): selected recipe controls and browser text selection. Pair with **Selection ink** (`selection-ink`, `dark-selection-ink`).
- **Focus ochre** (`focus`, `dark-focus`): shared keyboard focus outline.
- **Danger** (`danger`, `dark-danger`): unknown/failed status, inline warnings, error notices and destructive actions. This is a functional state color, not decoration.

### Neutral

- **Mineral ground** (`bg`, `dark-bg`): the page and workspace background.
- **Proof paper** (`surface`, `dark-surface`): form panels, cards, header and readable information planes; also the contrasting primary-button text role.
- **Ink** (`ink`, `dark-ink`): main text and primary-button hover fill.
- **Muted ink** (`muted`, `dark-muted`): supporting copy, metadata, placeholders and inactive navigation.
- **Divider** (`line`, `dark-line`): thin panel boundaries and structural rules.
- **Soft bed** (`soft`, `dark-soft`): canvas backing, skeletons and secondary-button hover.
- **Control edge** (`control-line`, `dark-control-line`): interactive field and choice boundaries, scrollbar thumb.

**The State Has Meaning Rule.** Aubergine identifies actions and completed states; ochre identifies chosen controls. Error and unknown states use the danger role with explanatory text, never color alone.

The SVG studies carry their own explicit artwork fills; those one-off illustration colors are not UI palette tokens. Sidecar tonal ramps are synthesized display metadata required by the design panel, not additional shipped CSS colors.

## Typography

**Display Font:** Hanken Grotesk, followed by PingFang SC, Microsoft YaHei and sans-serif.
**Body Font:** the same stack. The variable font is self-hosted at `public/fonts/hanken-grotesk.ttf`, normal style, weights 400–800, `font-display: swap`. Preserve `public/fonts/OFL-Hanken-Grotesk.txt` and `THIRD_PARTY_NOTICES.md`.
**Label/Mono Font:** labels use the same sans; actual code and request IDs inherit the existing SFMono-Regular, Consolas, monospace stack.

**Character:** a humanist working voice, using weight and scale rather than a separate decorative display face. Headings balance their lines and paragraphs use pretty wrapping.

### Hierarchy

- **Display:** the frontmatter display role is the English home headline; Chinese has its own recorded clamp and leading. English is capped at 11ch on desktop; Chinese at 9em. At the middle breakpoint the English headline becomes 3.8rem and on phones 3.4rem; Chinese retains its more specific locale rule.
- **Headline:** public explanatory sections use the recorded headline role; the keeping section is 1.9rem on desktop, with public section headings generally 2rem on phones.
- **Page title:** compact operating headings use the recorded page-title role, reducing to 1.7rem on phones. Pricing uses 3.2rem/1.1 at weight 650, reducing to 2.5rem.
- **Panel title:** the recorded panel-title role names recipe and inspection regions without an eyebrow.
- **Body:** the recorded body role describes the detail prompt (1rem/1.7). There is no single global body size: Studio prompts use 0.94rem/1.6, public introduction 1.06rem/1.65 and operating descriptions 0.94rem. Operating descriptions cap at 68ch; short empty-state copy caps at 43ch.
- **Label:** field labels use the recorded field-label role; helper copy uses 0.75rem/1.6. Buttons have a separate recorded role. Tabular allowance and detail data use tabular numerals.

**The One Family Rule.** Use Hanken Grotesk for headings, body and controls. Preserve the Chinese fallback stack and the bundled font license; reserve monospace for actual code and request identifiers.

## Layout

The main workspace is a two-column grid: a 200px sidebar beside a flexible work area, capped at 1800px. Desktop work-area padding is 32px 36px 48px. The header content is capped at 1600px with a 76px height and 36px horizontal inset. Public content uses a 1280px maximum and a viewport width minus 72px.

Studio places a recipe column (`minmax(300px, 360px)`) beside a flexible inspection canvas, separated by 28px. Panels use 20px form insets and 20px field-group gaps. Library begins with three columns and 24px gaps. Detail uses an image/info grid (`1.4fr` and `minmax(280px, .8fr)`) with 32px between. Public home pairs its large heading and explanation, then its recipe and proof; pricing uses three comparable plan columns. These are surface compositions, not requirements for every new page.

The spacing frontmatter records recurring observed steps rather than an invented universal progression. Tight controls use 6–12px gaps, panel insets 16–20px, group separation 24–32px, and public sections 48–88px according to content.

- At **1180px and below**, the sidebar is 174px, Studio recipe 310px and public side insets 24px; library becomes two columns.
- At **960px and below**, sidebar navigation becomes a separate horizontal, scrollable rail below the header; its supplementary user/label area is hidden. Studio uses a 320px recipe while space permits.
- At **760px and below**, Studio and detail stack, public home/keeping/pricing/auth stack, the header becomes 68px and operating content uses 20px side insets. Studio exposes a result jump and submission scrolls/focuses the status region. Library retains two columns with 16px gaps.
- At **420px and below**, library becomes one column and redundant header login/primary actions are hidden. At **360px and below**, header controls wrap onto a separate row.

The existing shared stylesheet also has 1100px, 850px and 640px adaptations for template and secondary surfaces. They remain implementation context, not new proof-bench layout primitives.

## Elevation & Depth

There are no panel shadows in the proof-bench system (`--shadow: none`, with common cards and buttons explicitly shadowless). Depth comes from paper against mineral ground, the soft inspection bed, a thin border and restrained selected surfaces. Shared keyboard focus is a three-pixel ochre outline with three-pixel offset; the inspection region uses a five-pixel offset. Shared sidebar navigation also defines a two-pixel ink focus outline with two-pixel offset.

**The Flat Bench Rule.** Panels rest on tonal surfaces and thin borders without shadows. The inherited one-pixel button hover lift is an interaction detail, not an elevation scale.

## Shapes

Use gently curved panels and precise controls: panel corners use the recorded panel radius; ordinary controls use the control radius; compact choice buttons use the choice radius. Small metadata blocks use the badge radius. Borders are generally one pixel; selected ratio/style controls change fill and edge, while the featured plan uses a two-pixel aubergine outline. The system does not ban borders: rules and panel edges are part of this world's structure.

Artwork remains inspectable without clipping the proof to decorative silhouettes. Ratio icons are exact rectangular outlines; the original vector studies use explicit circles and rectangles. Lucide supplies the interface icon family. The small status dot accompanies readable status text.

## Components

### Buttons

Confident, compact actions. Primary, secondary, ghost and danger variants share the recorded button typography, control radius and padding. The frontmatter `height` represents the **minimum** height from source, not a fixed-height constraint. Common buttons are at least 44px; Studio submission is at least 48px and full width. Existing compact `.small` buttons retain their 37px minimum; inspect controls are 40px and inline text actions 36px.

Primary fills with aubergine and uses proof-paper text; hover fills with ink. Secondary is transparent with a control-edge border and soft-bed hover. Ghost is transparent with ink text. Danger uses the danger fill. All share the inherited one-pixel upward hover translation when enabled. Color transitions are 160ms ease-out. Disabled buttons use opacity .5 and a not-allowed cursor; busy buttons expose `aria-busy` and a drawn loader. Focus remains visible. Do not generalize a hover lift to panels.

### Chips

Recipe style chips wrap in a native fieldset, with compact padding, choice corners and a 40px minimum. Ratio choices use five equal columns, a 64px minimum and an outlined ratio symbol. Both express selection with ochre, selection ink and `aria-pressed`. Library filter buttons use an aubergine wash instead, because they filter the archive rather than specify a recipe. The pricing period segment uses an aubergine selected fill.

### Cards / Containers

Paper-backed, bordered containers with panel corners and no shadow. Studio controls use a separated title bar and a 20px form inset; library cards use a 16px body inset (12px on phones), a contained image, prompt and readable status/actions. Pricing cards have 32px 26px desktop padding and 26px phone padding. Account cards retain the shared card structure. Avoid nested decorative card scaffolds; use actual task groups and dividers.

### Inputs / Fields

Studio fields have paper backgrounds, control edges and control corners. Prompt textareas use a 132px minimum, 12px padding and vertical resize; selects/inputs use a 44px minimum with 10px 12px padding. Native selects, labelled fieldsets and an advanced `details` disclosure keep the recipe progressive. Placeholders use muted ink at full opacity; carets and native accent controls use aubergine. Selection and scrollbar colors follow theme tokens.

Shared account/auth fields use the same aubergine focus border and three-pixel ochre outline with three-pixel offset. Their existing neutral background and compact field structure remain surface-specific variants.

### Navigation

Desktop operating navigation is a vertical rail with 44px-minimum links, 12px insets and control corners. Default text is muted, hover uses the soft bed and active navigation uses aubergine wash plus ink at weight 650. Mobile has its own horizontal rail below the header; it scrolls independently instead of overlaying the recipe. Native nested disclosures remain available where configured. Role filtering is presentation only: protected loaders/APIs authorize access.

### Proof Canvas and Lifecycle

The signature inspection canvas is a bordered soft bed with a separated heading and paper-backed information/actions. Empty and pending states are readable copy, not pretend imagery. A successful image uses `object-fit: contain`, 520px height and a 66svh maximum on desktop, 380px and 65svh on phones. Inspect toggles native-size overflow in the same region. Submission focuses the region; on phones it also scrolls to it with automatic behavior.

Status text is a polite live region with a small dot. Unknown and failed states use danger ink, retain their explanation and expose actions only when available. Unknown records without `canRefresh` direct users to the workspace operator with the request ID and retain the reservation. There is no invented progress percentage, automatic paid retry or promised application background queue. Download appears only for a successful job with a download URL; prompt reuse follows the supported completed states.

### Allowance

A paper strip with control corners, 16px 20px padding, tabular numerals and a native four-pixel progress bar. The progress measures used or reserved allowance, not generation completion. Remaining/limit, used/reserved and UTC period stay visible; a native disclosure explains policy. Account uses the same information without an extra card border. Do not hard-code plan counts from sample copy: render the service-provided configuration.

### Media and Motion

Public demonstrations use the exact geometric SVG studies in `art.tsx`, with an accessible label and caption explicitly saying they are original vectors rather than AI-generated images. Inherited public PNGs keep their embedded provenance. No live generation acceptance is claimed by those assets. Preserve private image URLs and download boundaries.

Motion is restrained and state-based: enabled button hover shifts one pixel, color changes ease out, and loaders rotate for real pending work (one second, linear). The result focus/scroll is the authored task transition. Reduced-motion rules remove animation/transition duration and force automatic scrolling; a surviving earlier rule also disables animations. Do not infer a page-entrance choreography from this record.

## Do's and Don'ts

### Do:

- **Do** keep the recipe, result and real status connected, with visible labels and recovery instructions.
- **Do** use the light and dark semantic roles together; preserve selection, caret, scrollbar and keyboard focus treatments.
- **Do** use native fieldsets, selects and disclosure controls, with explicit labels and selected states.
- **Do** preserve one deliberate request, the same recovery key and any unknown reservation; status checks follow the existing capability gate.
- **Do** keep image demonstrations truthful: label original vector studies and retain provenance on inherited raster assets.
- **Do** preserve EN/ZH copy, responsive navigation, reduced motion and the self-hosted font notices.

### Don't:

- **Don't** add kickers or eyebrows above headings, ornate marketing decoration or invented usage counters.
- **Don't** present vector studies as AI results or use CSS scenes as substitute generated artwork.
- **Don't** show fabricated progress percentages, imply a background application queue or offer a paid retry as recovery.
- **Don't** infer authorization from hidden navigation, or change provider, quota, private asset, auth or payment behavior through a visual extension.
- **Don't** propagate unused eyebrow rules or glyph-based placeholder icons into new proof-bench surfaces.

Not canonized or repaired in this documentation pass: dormant eyebrow/popular-label rules and the shared `Empty` glyph placeholder outside the Lumina-specific empty state. These surviving template devices are not proof-bench primitives. `docs/product.md` retains its reported legacy schema drift; its business contract is preserved, not rewritten here. No whole-surface or live-service certification is implied.
