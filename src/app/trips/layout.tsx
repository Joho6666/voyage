import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `我的旅行 · Voyage`,
};

export default function TripsTitleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
