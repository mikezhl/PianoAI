# Responsive layout specification

This document defines the responsive behavior shared by practice, analysis, and performance modes. Practice mode is the reference implementation: the other modes must use the same viewport model, logical orientation, pointer capability model, and transformed-coordinate rules.

## 1. Practice mode reference behavior

### 1.1 Viewport profile

The app derives one `ViewportProfile` in `src/App.tsx` and applies it to every mode.

- Read the visible viewport from `window.visualViewport`; fall back to `window.innerWidth` and `window.innerHeight`.
- Recompute on window resize, orientation change, visual viewport resize, and fine/coarse pointer media-query changes.
- Define `longEdge = max(width, height)` and `shortEdge = min(width, height)`. Component sizing must use these logical dimensions instead of physical portrait width and height.
- Use `rotated-long-edge` when the physical viewport is portrait and `natural-long-edge` otherwise. Portrait devices therefore receive the same logical landscape workspace as landscape devices.
- Classify `shortEdge < 700` as `compact`. Classify a coarse-pointer or portrait viewport with `shortEdge < 1100` as `regular`. All other viewports are `desktop`.
- Detect fine and coarse pointers independently. Hybrid devices may expose both. Box selection is allowed only when a fine pointer exists.

The root `.app-shell` publishes this profile through:

- `data-layout-mode`
- `data-size-class`
- `data-has-coarse-pointer`
- `data-has-fine-pointer`
- `--viewport-long-edge`
- `--viewport-short-edge`

Responsive CSS must consume these values. Raw width breakpoints cannot express the logical dimensions of a rotated portrait app and must not control mode layout.

### 1.2 Whole-app logical landscape

`natural-long-edge` fills the physical viewport without a transform. `rotated-long-edge` gives `.app-shell` the logical long-edge width and short-edge height, then rotates the entire app by 90 degrees around the top-left corner.

The transform applies to the whole product, including the top bar, menus, score, controls, overlays, and keyboard. A mode must never opt out of this rotation independently, because doing so creates different navigation and interaction models for the same device.

The root document remains fixed to the visible viewport with overflow hidden. Scrolling belongs to explicit inner regions such as the score, library, analysis list, and detail panel.

### 1.3 Compact and regular sizing

The practice layout keeps the same three structural rows: top bar, score workspace, and keyboard. Only their density changes.

- `compact`: 52 px top bar and a keyboard clamped to 96-128 px from the short edge.
- `regular`: 56 px top bar and a keyboard clamped to 118-168 px from the short edge.
- Top-bar text that is not essential is hidden in `compact`, while icon buttons retain accessible names and stable hit areas.
- Zoom and tempo values remain visible because their current state cannot be inferred from the icon alone.
- Menus and popovers are bounded by `--viewport-long-edge` so they stay inside the logical workspace after rotation.
- Practice playback controls retain fixed dimensions, and keyboard key labels shrink without changing the keyboard's row allocation.
- The existing compact class hides nonessential GitHub navigation to preserve room for score operations. Regular and desktop layouts retain it.

### 1.4 Score rendering and scrolling

Practice uses one horizontally scrollable score surface.

- `.score-scroll` owns horizontal panning and declares `touch-action: pan-x`.
- A predominantly vertical mouse wheel gesture is converted to horizontal score movement.
- OSMD measurements are taken with the root transform temporarily disabled. This keeps SVG geometry in the score's logical coordinate system instead of the rotated screen coordinate system.
- Score overlays, selection frames, playback cursors, MIDI markers, and hit testing all use the same logical score coordinates.
- The progress control supports pointer seeking and keyboard navigation. In rotated layout, pointer coordinates are transformed back through the inverse app matrix before seeking.

### 1.5 Pointer and selection behavior

Input behavior follows pointer capability, not screen width.

- A fine pointer can hover, click, Shift-extend, resize, and drag a box selection.
- Touch and pen begin in a pending state. Movement beyond the touch threshold pans the score; release without movement selects the tapped group.
- A coarse-only device does not start box selection accidentally while the user is trying to pan.
- Selection handles and action buttons remain operable on coarse pointers and receive larger hit targets.
- In rotated layout, pointer coordinates are inverse-transformed and adjusted for element offsets and score scroll before hit testing.
- Keyboard focus, button labels, progress-slider keys, MIDI input, playback, and range-selection behavior remain available independently of pointer type.

## 2. Shared requirements for every mode

1. All modes use the same `ViewportProfile` and the same root layout mode. Mode-specific orientation overrides are prohibited.
2. Layout decisions use `data-size-class`, pointer capability attributes, and logical-edge variables. Do not add physical-orientation `max-width` rules for app structure.
3. Any geometry read beneath a rotated `.app-shell` must be measured in the untransformed logical coordinate system.
4. Any pointer coordinate used for seeking, hit testing, tooltips, selection, or dragging beneath a rotated `.app-shell` must be inverse-transformed before it is compared with logical layout data.
5. Every scrollable region must have an explicit axis, bounded size, and touch behavior. Page-level scrolling is not a fallback.
6. Compacting may hide redundant labels, the established external-navigation exception, or collapse secondary information, but it must not remove a score, mode, playback, or selection command, a state indicator, or an accessible name.
7. Touch support cannot replace mouse or keyboard support. Hybrid devices must retain both coarse- and fine-pointer behavior.
8. Responsive changes must preserve score state, selected item/range, playback state, zoom, tempo, MIDI behavior, and mode switching across resize and orientation changes.

## 3. Analysis mode

Analysis mode uses its dedicated chunked, vertically scrolling score renderer but follows the same root viewport and coordinate rules.

- `desktop` and `regular` keep the established three-column layout: navigator, score, and detail.
- `compact` uses a two-column logical-landscape layout. The navigator remains on the left and the score receives the remaining width; the former portrait stack is not used.
- In `compact`, the detail panel collapses to a bottom-right 50 px summary control. Opening it overlays the score area within an 8 px inset and provides its own vertical scroll. Closing it restores the score without changing selection.
- The compact navigator scrolls vertically. Tabs stay visible above the list, item summaries clamp to one line, and item playback remains reachable.
- Coarse-pointer tabs, range buttons, and list playback controls have at least a 44 px target.
- OSMD chunk layout and cloned-SVG height are measured with the app transform disabled. Range overlays, playback cursor placement, automatic range scrolling, and lazy chunk rendering continue to use the resulting logical geometry.

## 4. Performance mode

Performance mode continues to use the shared horizontal `ScoreViewer` and adds interpretation overlays and a fixed playback dock.

- `compact` and `regular` reserve 104 px for the playback dock. Its context, transport, and progress rows remain visible and do not overlap the score.
- Performance menus and summary text are bounded by logical long-edge dimensions. The compact performance selector keeps its visible label because the current interpretation cannot be inferred from its icon.
- Interpretation overlays use the shared score geometry. Mouse hover and keyboard arrow/Home/End browsing remain supported.
- Touch or pen drag on an interpretation lane pans `.score-scroll` after the movement threshold and clears any tooltip. A release without movement inspects the tapped data point. Overlay interaction must not create an underlying score selection.
- In rotated layout, lane hit testing and panning use inverse-transformed logical coordinates plus the score's current horizontal scroll.
- Playback seeking, automatic score following, selection, performance audio controls, and score zoom must retain their established behavior.

## 5. Verification matrix

Responsive work is incomplete until the following checks pass with a representative built-in score in all three modes:

| Physical viewport | Expected profile | Required checks |
| --- | --- | --- |
| 1440 x 900 desktop | natural, desktop/regular by capability | Full navigation, score rendering, selection, playback, panels, no overlap |
| 1024 x 768 tablet landscape | natural, regular/desktop by capability | All columns/dock visible, touch and fine-pointer paths on hybrid hardware |
| 768 x 1024 tablet portrait | rotated, regular | Logical landscape fills screen, menus stay in bounds, score geometry and pointer targets align |
| 844 x 390 phone landscape | natural, compact | Compact top bar fits, score remains usable, controls and dock do not overlap |
| 390 x 844 phone portrait | rotated, compact | Same logical layout as phone landscape, correct panning/tapping/seeking after rotation |

For each viewport, verify:

- no document-level overflow, clipped commands, text overlap, blank score, or unintended layout shift;
- long-score scrolling, range navigation, cursor position, resize/orientation response, and panel open/close behavior;
- mouse hover/click where a fine pointer exists, touch pan/tap where a coarse pointer exists, keyboard focus/navigation, MIDI input, and audio controls;
- browser console has no uncaught errors during mode switches, playback, selection, scrolling, or panel interaction.

Automated completion gates remain `npm run check` and `npm run build:local`. Browser verification must additionally cover at least the desktop viewport and the `390 x 844` portrait viewport; tablet portrait and both natural-landscape mirrors are required whenever responsive layout code changes.
