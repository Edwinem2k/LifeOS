"use client";

import {
  BookOpen, Clapperboard, ShoppingBag, Lightbulb, List,
  Luggage, Home, Gift, Dumbbell, MapPin,
} from "lucide-react";

/**
 * lists.icon holds a Lucide component name as plain text. Emoji render flat on
 * Windows and saturated on iOS, so they are not a design we control (spec §5.5).
 * Unknown or null names fall back to a generic list glyph rather than breaking.
 */
const ICONS = {
  BookOpen, Clapperboard, ShoppingBag, Lightbulb, List,
  Luggage, Home, Gift, Dumbbell, MapPin,
} as const;

export type ListIconName = keyof typeof ICONS;

export function ListIcon({ name, size = 16, className }: {
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const Icon = (name && ICONS[name as ListIconName]) || List;
  return <Icon size={size} className={className} />;
}
