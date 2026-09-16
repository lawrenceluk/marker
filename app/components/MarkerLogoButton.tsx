"use client";

/** Outer size of toolbar icon buttons: p-2 (8+8) + 18px icon + 1px border ×2. */
export const TOOLBAR_CONTROL_PX = 36;

/**
 * Home mark — same footprint as toolbar controls; sharper source via ?v=4 icon.
 */
export function MarkerLogoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Marker home — clear session"
      title="Home"
      className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:focus-visible:ring-zinc-400"
    >
      <img
        src="/icon.svg?v=4"
        alt=""
        width={TOOLBAR_CONTROL_PX}
        height={TOOLBAR_CONTROL_PX}
        className="size-9"
        draggable={false}
      />
    </button>
  );
}
