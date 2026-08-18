type Props = {
  value: number; // 0-100
  size?: number;
  strokeWidth?: number;
  color?: string;
};

export function ProgressRing({
  value,
  size = 40,
  strokeWidth = 3.5,
  color = "var(--color-accent-success)",
}: Props) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = `${(circumference * value) / 100} ${circumference}`;

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
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="text-[10px] font-semibold fill-text-primary"
      >
        {Math.round(value)}%
      </text>
    </svg>
  );
}
