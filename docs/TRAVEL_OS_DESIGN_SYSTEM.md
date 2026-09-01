# Voyage Design System

Map and photography carry the product. Chrome stays quiet.

## Surfaces

| Token | Value | Use |
|---|---|---|
| `--background` | `#FAFAF9` | App canvas (warm stone, not pure white) |
| `--surface` | `#FFFFFF` | Panels, cards |
| `--foreground` | `#1C1917` | Primary text (never `#000`) |
| `--muted-foreground` | `#78716C` | Meta, captions |
| `--border` | `#E7E5E4` | Dividers, card edges |
| `--primary` | `#0F766E` | Teal CTA / selected / Day 1 route only |

Do not flood the UI with teal. Photos and the map are the visual system.

## Day colors

1. Teal `#0F766E`
2. Terracotta `#C2410C`
3. Blue `#1D4ED8`

Used on polylines, numbered markers, and day chips — not as page backgrounds.

## Radius

- Button: 10px (`--radius-md`)
- Input: 12px
- Card: 14px (`--radius-lg`)
- Forbidden: 24–32px super-round cards

## Shadow

Almost none. Prefer 1px border and surface contrast. Elevation only on floating map controls and popovers (`0 8px 24px rgba(28,25,23,0.08)`).

## Type

- Latin: Geist / Inter
- Chinese: Noto Sans SC / PingFang SC
- Scale: H1 40/48, H2 24/32, Section 16/24 medium, Body 14/22, Meta 13/18, Caption 12/16

## Interaction

- Hover: 150ms, slight surface lift or border darken
- Focus: 2px teal ring, 2px offset
- Selected: teal hairline + 4% teal fill
- Pressed: 96% scale on icon buttons
- Disabled: 40% opacity
- Motion: 150–250ms. Spring only for bottom sheet and map markers.

## Density

Desktop itinerary is dense (Wanderlog / Linear), not a card stack. Mobile uses a map + bottom sheet, not a squeezed desktop.

## Anti-patterns

No Ctrip clone, no OTA homepage, no blue/purple AI gradients, no glassmorphism pile, no emoji-as-icon, no 20 homepage CTAs.
