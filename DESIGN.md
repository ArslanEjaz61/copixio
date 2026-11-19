---
# gstack: design-md-format=spec
name: Autovex
description: Security-print fintech, sober and precise like a banknote or a bank statement, so traders trust it with real money.
colors:
  primary: "#0E2238"
  on-primary: "#F6F7F4"
  surface: "#FFFFFF"
  ground: "#F6F7F4"
  line: "#DCE1E4"
  text: "#0E2238"
  text-muted: "#5A6B7B"
  accent: "#C08A2E"
  on-accent: "#14100A"
  success: "#0F7B4A"
  warning: "#B45309"
  error: "#C2362F"
  info: "#24548F"
  dark-ground: "#0B1622"
  dark-surface: "#112131"
  dark-text: "#E9EDF0"
typography:
  display:
    fontFamily: Schibsted Grotesk
    fontWeight: 800
    fontSize: clamp(2.2rem, 4.4vw, 4rem)
    letterSpacing: -0.02em
  heading:
    fontFamily: Schibsted Grotesk
    fontWeight: 700
    fontSize: clamp(1.6rem, 2.6vw, 2.4rem)
    letterSpacing: -0.01em
  body:
    fontFamily: Source Sans 3
    fontSize: 1rem
    lineHeight: 1.55
  label:
    fontFamily: Source Sans 3
    fontSize: 0.75rem
    letterSpacing: 0.06em
  mono:
    fontFamily: JetBrains Mono
    fontFeature: tnum
rounded:
  sm: 6px
  md: 10px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  3xl: 96px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  button-cta:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
  button-cta-hover:
    backgroundColor: "#D29A3A"
  input:
    borderColor: "#C9D0D5"
    rounded: "{rounded.sm}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
  nav-link:
    textColor: "{colors.text}"
---

# Autovex

## Overview

**Creative North Star:** the trust of printed money. Precise type, ink and paper, one brass detail. Nothing glows.
**Product context:** a paid SaaS. Traders connect their own Binance (live or demo) and KuCoin API keys and their Telegram account. They choose the signal groups they follow and set money rules per group. The bot reads each new signal and trades on their exchange. Peers are Cornix, WunderTrading and 3Commas, which mostly read as dark, neon crypto tools.
**Mode per surface:** the landing page Persuades; the app (dashboard, groups, rules, exchanges, billing, admin) is for Operating.
**Reference sites:** cornix.io, wundertrading.com, saasframe.io fintech gallery.
**Key characteristics:**
- A full-bleed ink hero.
- The product's mechanism shown live: a signal becomes an order ticket.
- Money in mono numerals.
- Brass used only where it matters.

## Colors

**Strategy:** Restrained. Ink and paper carry everything.
- **Brass** appears only on the mark, the one main call to action per view, and the current onboarding step.
- **Success / error** mean profit and loss (or pass and fail), never decoration.
- **Light or dark:** light by default. Users check money and set rules by day, at a desk or on a phone. Dark mode gets its own ink-blue surfaces (dark-* tokens); it is not an inverted light theme.
- **Named rules:**
  - Interaction is ink.
  - Emphasis is size or weight, never gradient text.
  - Neutrals lean slightly toward the ink blue.

## Typography

**Schibsted Grotesk** is a sturdy news grotesk with confident headlines. Its display weight appears once per screen.

**Source Sans 3** is for reading, forms and tables.

**JetBrains Mono** with tabular figures is for every price, size, percentage and P&L, so money columns align.

Everything loads from Google Fonts with display=swap. The scale steps by more than weight: display ≥ 2.2rem, heading ≥ 1.6rem, body 1rem.

## Layout

The landing page runs **full-bleed**: every section's background spans the whole viewport. There is no boxed page with side margins on laptops.

- Content sits in a 1280px reading column inside each section, with a gutter of 24px (16px on phones).
- The app uses a fixed 240px ink sidebar and a fluid main area. On phones the sidebar becomes a top bar with a menu.
- Rhythm: landing sections use 96px of vertical padding; app spacing uses 16/24px.

## Elevation & Depth

Use 1px line borders on paper first. Floating objects only (the order ticket, menus, dialogs) get an offset soft shadow: 0 14px 34px rgba(0,0,0,.25). Never a zero-offset glow, and never a card inside a card.

## Shapes

- 6px for controls (buttons, inputs, segments).
- 10px for panels.
- Full rounding for status pills and avatars only.

## Components

- **Buttons:**
  - Primary is ink on paper.
  - CTA is brass, at most one per view.
  - Secondary is a line button.
  - Tertiary is underlined text.
  - States: a visible focus ring in brass; disabled at 45% opacity.
- **Status pills** are a tint background plus text, never colored borders.
- **Money cells** are always mono, right-aligned, with a sign (+ / −).
- **Errors** say what happened and what to do, in one sentence.

## Do's and Don'ts

- **Do:**
  - show the real mechanism or the real UI instead of illustrations;
  - write calls to action that name the outcome;
  - set money in mono with signs;
  - state every security promise plainly.
- **Don't:**
  - neon or glow, purple gradients, or the 3-column icon grid;
  - a boxed landing page with white side margins;
  - fake testimonials or vanity counters;
  - show internal design specimens (logo boards, swatches) to users.

## Motion

- **Approach:** intentional and minimal.
- **Easing:** enter ease-out, exit ease-in, move ease-in-out.
- **Duration:** micro 80ms; short 200ms; medium 350ms.
- **The one authored moment:** the hero's Telegram signal fills an order ticket row by row, then reads "Filled".
- Respects prefers-reduced-motion.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-19 | Initial design system, created with /design-consultation from category research | The user wants traders to remember trust ("serious paisa, safe"), not crypto hype |
| 2026-11-19 | Landing page full-bleed; no design specimens on user-facing pages | User: "full screen chahiye, logo/colors user ko show nahi" |
