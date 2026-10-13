/*
 * Primitive control styles, one per Figma component on "Components (new)".
 * Each is a complete look including size, so call sites only add layout
 * (width, flex). tests/browser/figma-eval.spec.ts grades them against Figma.
 */

/** Focus: a 2px --focus-ring outline at a 2px offset that follows the shape. */
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring";

const buttonBase =
  `inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:opacity-40 ${focusRing}`;

/** Figma Button Size=sm (32px, UI/Small Medium) and Size=md (48px, UI/Body Medium). */
const buttonSize = {
  sm: "h-8 px-4 text-sm",
  md: "h-12 px-6 text-base",
} as const;
export type ButtonSize = keyof typeof buttonSize;

/**
 * Figma Button Kind=Primary: the slab, hover slab/hover. Its border is transparent (no visible
 * stroke, as in Figma) so a primary and a secondary with the same label are the same width.
 */
export function primaryButtonClass(size: ButtonSize = "sm") {
  return `${buttonBase} ${buttonSize[size]} border-transparent bg-slab text-on-slab hover:bg-slab-hover disabled:hover:bg-slab`;
}

/** Figma Button Kind=Secondary: hairline outline, hover rule/ink. */
export function secondaryButtonClass(size: ButtonSize = "sm") {
  return `${buttonBase} ${buttonSize[size]} border-hairline bg-transparent text-foreground hover:border-rule-ink disabled:hover:border-hairline`;
}

/**
 * Figma TextInput: underline only, 56px, placeholder in text/muted as the only label.
 * Focus thickens the underline to 2px with an inset shadow, so the text never moves.
 */
export function textInputClass(font: "sans" | "mono" = "sans") {
  const type = font === "mono" ? "font-mono text-sm" : "text-base";
  return `h-14 rounded-none border-0 border-b border-hairline bg-transparent px-0 ${type} text-foreground placeholder:text-muted outline-none focus:border-focus-ring focus:shadow-[inset_0_-1px_0_var(--focus-ring)] disabled:opacity-40`;
}

/**
 * Figma IconButton: a borderless 20px glyph in a 48px hit area. Default muted,
 * hover and pressed ink, armed (a destructive second tap) danger. Focus is a 2px
 * ring inside the hit area, as in Figma.
 */
const iconButtonBase =
  "group relative inline-flex size-12 shrink-0 items-center justify-center border-0 bg-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-40 [&>svg]:size-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring";

export const iconButtonClass = `${iconButtonBase} text-muted hover:text-foreground focus-visible:text-foreground disabled:hover:text-muted`;
export const iconButtonPressedClass = `${iconButtonBase} text-foreground`;
export const iconButtonArmedClass = `${iconButtonBase} text-danger`;
