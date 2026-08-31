---
name: Alexandria
description: A civic reading index for discovering and opening original documents.
colors:
  ink-blue: "#071e4a"
  mineral-white: "#f7f5ef"
  route-orange: "#f26b21"
  route-mint: "#d9f4eb"
  focus-mint: "#71d6be"
  annotation-green: "#087465"
  reading-blue: "#27416c"
  muted-blue: "#526889"
  field-white: "#ffffff"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "3.75rem"
    fontWeight: 900
    lineHeight: 0.94
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
rounded:
  square: "0px"
  route-dot: "9999px"
spacing:
  compact: "8px"
  control: "16px"
  page: "20px"
  section: "32px"
components:
  action-primary:
    backgroundColor: "{colors.route-orange}"
    textColor: "{colors.ink-blue}"
    rounded: "{rounded.square}"
    padding: "12px 16px"
  action-secondary:
    backgroundColor: "{colors.route-mint}"
    textColor: "{colors.ink-blue}"
    rounded: "{rounded.square}"
    padding: "8px 16px"
  search-field:
    backgroundColor: "{colors.field-white}"
    textColor: "{colors.ink-blue}"
    rounded: "{rounded.square}"
    padding: "16px 20px"
---

# Design System: Alexandria

## Overview

**Creative North Star: "The Civic Reading Index"**

Alexandria is a useful public institution expressed as an interface: confident, orderly, and deliberately non-antiquarian. Ink-blue rules turn navigation and grouping into visible wayfinding; a warm mineral field makes the material approachable instead of sterile. The public Library begins with search and a route map because the product helps people find a path into primary documents, not admire a virtual bookshelf.

Reader and Admin use the same visual grammar at different densities. The Reader recedes to a compact dark control bar so the source document remains primary. The Admin workspace becomes a mineral panel on an ink-blue field: operational without turning into a generic dashboard.

**Key Characteristics:**

- Search-first public discovery with a visible route structure.
- Strong, square editorial rules instead of soft consumer-app cards.
- Sparse orange, mint, and violet route signals; color supports scanning, never decoration.
- System typography, high contrast, explicit focus, and complete tap targets.

## Colors

The palette is a public-signage system: dark ink establishes authority, mineral white gives documents air, and route colors identify movement and action.

### Primary

- **Ink Blue:** primary structure, mastheads, borders, text, and the Reader shell. It is the visual authority of Alexandria.
- **Route Orange:** reserved for primary publication actions, selection, and editorial underlines.

### Secondary

- **Route Mint:** a quiet active/hover surface and the soft companion to Ink Blue.
- **Focus Mint:** the visible keyboard focus ring against both light and dark surfaces.

### Tertiary

- **Annotation Green:** small category metadata where a darker green is needed for readable text.

### Neutral

- **Mineral White:** the main public reading field and paper-like admin panel.
- **Reading Blue:** long-form supporting copy and secondary navigation on light surfaces.
- **Muted Blue:** dates, counts, and quiet metadata.
- **Field White:** inputs and controls that need crisp separation from the mineral field.

**The Route-Signal Rule.** Orange, mint, green, and violet identify a route, state, or action. Do not use them as broad decorative fills.

## Typography

**Display Font:** system sans (`ui-sans-serif, system-ui, sans-serif`)

**Body Font:** system sans (`ui-sans-serif, system-ui, sans-serif`)

**Character:** The type is compact, direct, and highly legible. Heavy display weights create editorial authority without introducing a historical-library pastiche.

### Hierarchy

- **Display:** used for the Library arrival statement; near-60px on wide screens, black weight, and tight tracking.
- **Headline:** used for page titles, result headings, and document titles; black weight with slightly tightened tracking.
- **Title:** used for controls and section titles; bold or black at 16–24px depending on hierarchy.
- **Body:** 16px copy with generous 1.75 line-height for summaries and instructional text.
- **Label:** 14px bold labels; route and category labels may use uppercase with tracked letters.

**The One-Voice Rule.** Do not introduce a display serif or decorative font. Alexandria’s authority comes from hierarchy, rules, and spacing.

## Layout

Public pages use a centered wide container with 20px mobile gutters, expanding to 32px and 48px on larger breakpoints. The Library changes from an asymmetric route/list grid on large screens to one reading flow on mobile. The route column may stick at the top on desktop, but never hides core results.

Controls and document rows use a clear 8px/16px/32px rhythm. The Reader owns the viewport: its header has fixed visual weight while the document frame takes remaining height. Admin prioritizes a narrow, readable working column rather than filling space with widgets.

## Elevation & Depth

Alexandria is flat by default. Borders, dark rules, and background changes establish hierarchy. Only the public search field and the Admin mineral panel use a restrained structural shadow to lift an interactive or operational surface from its field.

### Shadow Vocabulary

- **Search Lift:** `8px 10px 22px rgba(7,30,74,0.12)`, strengthened while its input is focused.
- **Admin Panel:** `14px 16px 32px rgba(0,0,0,0.24)` for a single operational sheet on the ink field.

**The Flat-By-Default Rule.** Do not add shadows to every document row or card. Lift only a surface that needs spatial priority.

## Shapes

The system is intentionally square: buttons, inputs, route rows, document rows, panels, and tags rely on 0px corners and firm 1–4px rules. The only circular geometry is the small colored route dot and compact status marks. This makes the page feel like a precise index rather than a collection of floating cards.

## Components

### Buttons

- **Shape:** square edges (0px) with firm borders where secondary.
- **Primary:** Route Orange with Ink Blue text and black label weight; used for sign-in and publish.
- **Secondary:** Mint hover fill or an Ink Blue outline; used for route selection and progressive loading.
- **Hover / Focus:** background changes are quick and functional; `#71d6be` or Ink Blue outlines must remain visible with keyboard focus.

### Chips

- **Style:** white/mineral field with an Ink Blue translucent border and muted-blue text.
- **State:** metadata only; chips do not imitate raised pills.

### Cards / Containers

- **Corner Style:** square.
- **Background:** document rows remain on the page field; the Admin sheet and focused search are the rare raised containers.
- **Border:** horizontal Ink Blue rules define listing rows and section boundaries.

### Inputs / Fields

- **Style:** white field, 2px Ink Blue border, roomy 12–16px vertical padding.
- **Focus:** a clearly visible 2px offset outline, never a color-only placeholder change.
- **Disabled:** a pale orange field still carrying dark Ink Blue text so the state remains readable.

### Navigation

- **Style:** Ink Blue masthead with mineral-white wordmark and mint administrative link.
- **States:** route controls use `aria-pressed` and a mint hover surface; text links use an orange underline where context benefits from a reading cue.

### Document Row

- **Character:** a complete clickable record, not a tile.
- **Structure:** category path, title, description, tags, date, and directional arrow are organized in a responsive grid with one horizontal rule.

## Do's and Don'ts

### Do:

- **Do** use Ink Blue rules and mineral space to establish hierarchy before adding a new container.
- **Do** make search, filters, buttons, and complete document rows keyboard reachable with visible focus.
- **Do** use route color sparingly to make category paths and primary actions faster to scan.
- **Do** preserve the Reader’s compact shell and its security-isolated content frame.

### Don't:

- **Don't** use rounded, shadowed dashboard cards for ordinary library records.
- **Don't** use parchment textures, faux bookshelves, classical columns, or antique-library imagery.
- **Don't** cache API or authenticated Admin responses in the PWA shell.
- **Don't** hide important metadata behind hover-only interactions.
