type Props = {
  value: number; // 0-100
  size?: number;
  strokeWidth?: number;
};

export function ProgressRing({
  value,
  size = 40,
  strokeWidth = 3.5,
}: Props) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = `${(circumference * value) / 100} ${circumference}`;

  // Smooth red→amber→green gradient via HSL hue (0=red, 60=amber, 120=green)
  const hue = Math.round((value / 100) * 120);
  const color = `hsl(${hue}, 70%, 45%)`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-border-default)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
