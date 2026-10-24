# Independent UI primitives

This directory provides the documented form, overlay, navigation, data-display, layout, and feedback component families. Interactive overlays and controls use the installed `@base-ui/react` primitives. Import paths follow familiar shadcn-style module names; these are independently assembled wrappers, not copied private template files or a claim of identical shadcn source.

- Actual application usage: Base UI `Dialog` manages focus trapping, Escape, focus restoration and portals; Base UI `Input` powers shared fields; Base UI `Menu` powers the signed-in account menu.
- Compound primitives preserve the upstream Base UI typed props and keyboard/state behavior. Compose Root/Trigger/Portal/Positioner/Content parts as required by the installed library, and apply the shared CSS tokens/classes.
- `Calendar` is an original single-date picker with month navigation and arrow-key day focus. `Carousel` is an original scroll-snap carousel. `Resizable` is an original two-panel pointer/keyboard separator. These are intentionally bounded helpers, not full third-party-library replacements.
- UI copy and custom styles are original. Optional illustrative landing layouts live in examples/landing-page and are not part of the default homepage.
- Browser interaction and visual regression tests must be run in an environment that can launch Chromium; source/type validation does not prove focus or visual correctness.
