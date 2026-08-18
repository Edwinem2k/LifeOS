"use client";

import { useEffect, useState } from "react";

type Variant = "default" | "success" | "error";
type ToastData = { message: string; variant: Variant };

let showToastGlobal: (message: string, variant?: Variant) => void = () => {};

export function toast(message: string, variant: Variant = "default") {
  showToastGlobal(message, variant);
}

const variantBorder: Record<Variant, string> = {
  default: "border-border-default",
  success: "border-l-4 border-l-accent-success border-border-default",
  error: "border-l-4 border-l-accent-danger border-border-default",
};

export function Toast() {
  const [data, setData] = useState<ToastData | null>(null);

  useEffect(() => {
    showToastGlobal = (message, variant = "default") => {
      setData({ message, variant });
      setTimeout(() => setData(null), 2500);
    };
  }, []);

  if (!data) return null;

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 bg-elevated text-text-primary rounded-md shadow-lg px-4 py-3 text-sm border ${variantBorder[data.variant]}`}
    >
      {data.message}
    </div>
  );
}
