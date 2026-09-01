import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-sm">
        <h1 className="text-2xl font-medium">页面不存在</h1>
        <p className="mt-2 text-sm text-muted-foreground">回到旅行列表，或从一句自然语言重新创建。</p>
        <div className="mt-4 flex gap-2">
          <Button asChild>
            <Link href="/trips">我的旅行</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/new-trip">创建旅行</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
