/** Coffee-bean mark for grind steps (distinct from Lucide's legume Bean icon). */
export function CoffeeBeanIcon({ className, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M12 4c-4 0-7 2.8-7 7.5S8 20 12 20s7-3.2 7-8.5S16 4 12 4z" />
      <path d="M12 4c2.5 2.2 3.5 5.2 3.5 8.5S14 19 12 20" />
    </svg>
  );
}
