import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-2 rounded-[14px] border border-dashed border-border p-6", className)}>
      <h3 className="text-sm font-medium">{title}</h3>
      {description ? <p className="text-[13px] leading-5 text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}
