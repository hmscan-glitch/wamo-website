# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the static marketing website for **WAMO – All In Steak**, a halal steakhouse restaurant in Dortmund, Germany. The site is a single German-language page.

## Development Workflow

There is no build system, package manager, or framework. Development is pure HTML/CSS/JS.

**To preview the site locally:**
```bash
# Any simple static server works, e.g.:
python3 -m http.server 8000 --directory wamo-website
# Then open http://localhost:8000
```

Or open `wamo-website/index.html` directly in a browser.

## Architecture

The entire site lives in **one file**: `wamo-website/index.html`. All CSS is in a `<style>` block in `<head>`, and all JavaScript is in a `<script>` tag at the bottom of `<body>`. There is no external CSS or JS file — everything is self-contained.

**CSS design tokens** are defined as custom properties in `:root`:
- `--gold` / `--gold-light` — primary brand accent
- `--red` / `--red-hot` — secondary accent
- `--dark` through `--dark4` — layered dark backgrounds (#0a0a0a → #222222)
- `--text` / `--text-muted` — foreground colors
- `--border` — gold at 20% opacity

**Page sections** (in order, each anchored by `id`): `#home` (hero) → `#concept` → `#menu` → `#burger` (À la Carte) → `#hours` → `#reservation` → `#reviews` → `footer`.

**JavaScript modules** (all inline at page bottom):
1. **Navbar scroll** — adds `.scrolled` class on scroll >60px
2. **Hamburger/mobile menu** — toggles `.open` on `#mobileMenu`
3. **Scroll reveal** — `IntersectionObserver` activates `.reveal`, `.reveal-left`, `.reveal-right`, `.reveal-scale` classes
4. **Ember canvas** (`#emberCanvas`) — fire particle system for the hero background; spawns ember/smoke particles floating upward
5. **Sizzle steak canvas** (`#sizzleCanvas`) — animated canvas illustration of a sizzling steak with steam, grill bars, marbling veins, and heat shimmer; runs at ~28fps via `requestAnimationFrame`
6. **Reservation form** — validates required fields, hides the form and shows `#successMsg`, then opens a `mailto:info@wamo-restaurant.de` link with form data pre-filled

## Known Gaps / Inconsistencies

- `wamo-website/images/trueffel-pasta.jpg` is referenced in the HTML (Trüffel Pasta card) but **does not exist** in the repository — the card will show a broken image.
- The mobile nav links to `#livemusic` and there is CSS for `#livemusic`, but **no `<section id="livemusic">` exists** in the HTML.
- The reservation form uses a `mailto:` link — there is no backend. Real submissions require integrating an email service (e.g., Formspree, EmailJS) or a server endpoint.

## Content Language

All user-visible text is in **German**. Navigation labels, section headings, form fields, button text, and review copy are all German. Keep this consistent when adding or editing content.
