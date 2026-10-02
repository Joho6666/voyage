import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `设置 · Voyage`,
};

export default function SettingsTitleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
