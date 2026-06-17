"use client";

import React from "react";

type Variant = "indigo" | "emerald" | "red" | "amber" | "secondary";
type Size = "default" | "sm" | "icon";

interface PixelButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: React.ReactNode;
}

const variantClass: Record<Variant, string> = {
  indigo: "pixel-btn pixel-btn-indigo",
  emerald: "pixel-btn pixel-btn-emerald",
  red: "pixel-btn pixel-btn-red",
  amber: "pixel-btn pixel-btn-amber",
  secondary: "pixel-btn pixel-btn-secondary",
};

const sizeClass: Record<Size, string> = {
  default: "",
  sm: "pixel-btn-sm",
  icon: "pixel-btn-icon",
};

export function PixelButton({
  variant = "secondary",
  size = "default",
  loading = false,
  children,
  className = "",
  disabled,
  ...props
}: PixelButtonProps) {
  const classes = [
    variantClass[variant],
    sizeClass[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button {...props} className={classes} disabled={disabled || loading}>
      {loading ? (
        <span
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            border: "2px solid rgba(255,255,255,0.4)",
            borderTopColor: "#fff",
            borderRadius: "50%",
            animation: "pixel-spin 0.6s linear infinite",
          }}
        />
      ) : (
        children
      )}
    </button>
  );
}
