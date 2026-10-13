// Size (padding, text size) stays at the call site so controls can match the
// input they sit beside; everything else about a control's look lives here.
const buttonBase =
  "rounded-lg border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export const primaryButtonClass = `${buttonBase} border-slab bg-slab text-on-slab hover:border-slab-hover hover:bg-slab-hover`;

export const secondaryButtonClass = `${buttonBase} border-hairline text-foreground hover:border-rule-ink`;

export const textInputClass =
  "rounded-lg border border-hairline bg-background text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50";
