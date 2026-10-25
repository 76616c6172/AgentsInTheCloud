/**
 * Nox spread: large touch screens, such as an unfolded foldable or a tablet, show the phone's ring
 * two pages at a time. The phone layout and its state still apply (phoneLayoutMediaQuery matches
 * too); nox-layout.css repeats this query for the spread geometry.
 *
 * The spread has three stops, --nox-spread on the app: Workspaces | Agent (0), Agent | Work (1) and
 * Work on its own (2). The list's open state picks 0, the presentation's data-nox-work-alone picks
 * 2, and swipes move one stop at a time (mobile-swipe-controller).
 */
export const noxSpreadMediaQuery = "(hover: none) and (pointer: coarse) and (min-width: 600px) and (min-height: 480px)";

/** The split snaps to these fractions of the width; the middle one is the fold. */
export const noxSpreadSplits: readonly number[] = [0.382, 0.5, 0.618];
export const noxSpreadSplitStorageKey = "agents-in-the-cloud:nox-spread-split";
