export function Logo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Triangle */}
      <path
        d="M50 5L95 90H5L50 5Z"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Circle */}
      <circle
        cx="50"
        cy="58"
        r="22"
        stroke="currentColor"
        strokeWidth="5"
        fill="none"
      />
      {/* Vertical line */}
      <line
        x1="50"
        y1="5"
        x2="50"
        y2="90"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}
