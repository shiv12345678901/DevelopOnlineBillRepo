/* SF Symbols — Apple's icon library, inline SVG (no web CDN exists) */

export const SF = {
  house: "M12 3l9 8h-3v9h-4v-6H10v6H6v-9H3z",
  docText: "M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 16.5h6 M10 20h4",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3.5 2",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 2v2.5 M12 19.5V22 M2 12h2.5 M19.5 12H22 M4.9 4.9l1.8 1.8 M17.3 17.3l1.8 1.8 M19.1 4.9l-1.8 1.8 M6.7 17.3l-1.8 1.8",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z",
  circleHalf: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 3v18",
} as const;

export type SFSymbolName = keyof typeof SF;

export function SFSymbol({ name, filled }: { name: SFSymbolName; filled?: boolean }) {
  return (
    <svg
      className="sf-icon"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={SF[name]} />
    </svg>
  );
}
