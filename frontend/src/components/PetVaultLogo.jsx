/**
 * PetVault brand components.
 *
 * PetVaultIcon  — the heart icon mark only (no text)
 * PetVaultWordmark — icon + "PetVault" logotype side-by-side
 *
 * Design: split heart, left half terracotta with white paw print,
 *         right half cream with sage medical cross, sage divider & border.
 */

/** Icon mark only. Pass `size` in px (default 32). */
export function PetVaultIcon({ size = 32, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* ── Left half of heart — terracotta ── */}
      <path
        d="M16 8.2
           C14.4 6.6 12.3 5.5 9.9 5.5
           C5.8 5.5 2.5 8.6 2.5 12.7
           C2.5 17.2 6.1 21.6 16 27.6
           L16 8.2Z"
        fill="#D26D53"
      />

      {/* ── Right half of heart — warm cream ── */}
      <path
        d="M16 8.2
           C17.6 6.6 19.7 5.5 22.1 5.5
           C26.2 5.5 29.5 8.6 29.5 12.7
           C29.5 17.2 25.9 21.6 16 27.6
           L16 8.2Z"
        fill="#EEE8DA"
      />

      {/* ── Full heart outline — sage ── */}
      <path
        d="M16 8.2
           C14.4 6.6 12.3 5.5 9.9 5.5
           C5.8 5.5 2.5 8.6 2.5 12.7
           C2.5 17.2 6.1 21.6 16 27.6
           C25.9 21.6 29.5 17.2 29.5 12.7
           C29.5 8.6 26.2 5.5 22.1 5.5
           C19.7 5.5 17.6 6.6 16 8.2Z"
        stroke="#556045"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />

      {/* ── Center divider — sage ── */}
      <line
        x1="16" y1="8.2"
        x2="16" y2="27.6"
        stroke="#556045"
        strokeWidth="0.9"
        strokeLinecap="round"
      />

      {/* ── Paw print — white on terracotta half ── */}
      {/* Main pad */}
      <ellipse cx="9.8" cy="20.2" rx="2.3" ry="1.85" fill="white" />
      {/* Toe pads */}
      <circle cx="7.6"  cy="17.1" r="1.08" fill="white" />
      <circle cx="9.8"  cy="16.1" r="1.08" fill="white" />
      <circle cx="12.0" cy="17.1" r="1.08" fill="white" />

      {/* ── Medical cross — sage on cream half ── */}
      <rect x="21.4" y="13.5" width="2.0" height="7.5" rx="1" fill="#556045" />
      <rect x="18.7" y="16.3" width="7.5" height="2.0" rx="1" fill="#556045" />
    </svg>
  );
}

/**
 * Full wordmark: icon + "PetVault" text.
 *
 * Props:
 *   iconSize  — px size of the icon (default 32)
 *   textSize  — Tailwind font-size class (default "text-[1.35rem]")
 *   className — extra classes on the wrapper span
 */
export function PetVaultWordmark({
  iconSize = 32,
  textSize = "text-[1.35rem]",
  className = "",
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <PetVaultIcon size={iconSize} />
      <span
        className={`font-serif-display ${textSize} leading-none tracking-tight`}
      >
        <span className="text-[#2D2C28]">PetBill </span>
        <span className="text-[#D26D53]">Shield</span>
      </span>
    </span>
  );
}

/**
 * Icon wrapped in a dark rounded badge — matches the existing header style.
 * Use this when placing the icon on a light/glass background.
 */
export function PetVaultBadge({ iconSize = 18, badgeSize = "w-9 h-9", className = "" }) {
  return (
    <span
      className={`${badgeSize} rounded-md bg-[#2D2C28] inline-flex items-center justify-center shrink-0 ${className}`}
    >
      <PetVaultIcon size={iconSize} />
    </span>
  );
}
