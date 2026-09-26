// Size (padding, text size) stays at the call site so controls can match the
// input they sit beside; everything else about a control's look lives here.
const buttonBase =
  "rounded-lg border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export const primaryButtonClass = `${buttonBase} border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-700 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300`;

export const secondaryButtonClass = `${buttonBase} border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`;

export const textInputClass =
  "rounded-lg border border-zinc-300 bg-background text-foreground placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:placeholder-zinc-500 dark:focus:ring-zinc-400";
