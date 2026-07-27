import * as React from "react";
import Image from "next/image";

import { cn } from "@/shared/utils/cn";

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  src?: string | null;
  alt: string;
  size?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: { box: "h-8 w-8", text: "text-xs", px: 32 },
  md: { box: "h-11 w-11", text: "text-sm", px: 44 },
  lg: { box: "h-16 w-16", text: "text-lg", px: 64 },
} as const;

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Shows a Cloudinary-hosted photo when present, otherwise initials. */
export function Avatar({ src, alt, size = "md", className, ...props }: AvatarProps) {
  const dims = sizeMap[size];
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 font-semibold text-primary",
        dims.box,
        dims.text,
        className,
      )}
      {...props}
    >
      {src ? (
        <Image src={src} alt={alt} fill sizes={`${dims.px}px`} className="object-cover" />
      ) : (
        <span aria-hidden>{initialsFrom(alt)}</span>
      )}
    </span>
  );
}
