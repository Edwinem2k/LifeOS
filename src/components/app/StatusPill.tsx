import { getPillColor, formatLabel, type PillType } from "@/lib/constants";

type Props = {
  value: string;
  type: PillType;
};

export function StatusPill({ value, type }: Props) {
  const color = getPillColor(value, type);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium whitespace-nowrap"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
    >
      {formatLabel(value)}
    </span>
  );
}
