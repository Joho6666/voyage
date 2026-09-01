"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";

type Ratio = "4/3" | "16/9" | "1/1";

export function TravelImage({
  src,
  alt,
  ratio = "4/3",
  className,
}: {
  src: string;
  alt: string;
  ratio?: Ratio;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const aspect = ratio === "16/9" ? "aspect-video" : ratio === "1/1" ? "aspect-square" : "aspect-[4/3]";

  if (failed || !src) {
    return (
      <div
        className={cn(aspect, "w-full bg-gradient-to-br from-stone-200 via-teal-100 to-stone-300", className)}
        aria-hidden
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(aspect, "w-full object-cover", className)}
    />
  );
}
