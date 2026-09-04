"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCurrentUser,
  signInWithMagicLink,
  signInAnonymously,
  signOutUser,
  isSupabaseConfigured,
} from "@/services/supabase/auth";
import type { User } from "@supabase/supabase-js";
import { ShieldCheck, Mail, LogOut, UserCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const isConfigured = isSupabaseConfigured();

  useEffect(() => {
    if (open) {
      void getCurrentUser().then(setUser);
    }
  }, [open]);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    const res = await signInWithMagicLink(email.trim());
    setLoading(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("登录链接已发送至邮箱，请查收");
      onOpenChange(false);
    }
  };

  const handleAnonymous = async () => {
    setLoading(true);
    const res = await signInAnonymously();
    setLoading(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("已切换为游客会话模式");
      void getCurrentUser().then(setUser);
      onOpenChange(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    await signOutUser();
    setLoading(false);
    setUser(null);
    toast.info("已退出当前登录");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,440px)] p-5">
        <div className="flex items-center gap-2 text-primary text-[12px] font-medium">
          <ShieldCheck className="size-4" />
          <span>Voyage 账号与会话管理</span>
        </div>
        <DialogTitle className="mt-1 text-lg font-medium text-foreground">
          {user?.email ? "已登录账户" : "登录 Voyage"}
        </DialogTitle>

        {/* Status Box */}
        <div className="mt-3 rounded-[12px] border border-border bg-secondary/50 p-3.5 space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>存储后端环境</span>
            <span className={isConfigured ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>
              {isConfigured ? "Supabase RLS 隔离已就绪" : "本地内存 Demo 模式"}
            </span>
          </div>
          <div className="pt-2 border-t border-border/60 flex items-center gap-2">
            <UserCircle className="size-5 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">
                {user?.email || user?.user_metadata?.name || "游客 (Guest Traveler)"}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                ID: {user?.id ?? "local-session"}
              </p>
            </div>
          </div>
        </div>

        {/* Email Magic Link Form */}
        <form onSubmit={handleMagicLink} className="mt-4 space-y-3">
          <div>
            <label className="text-[12px] font-medium text-foreground block mb-1">
              邮箱快捷登录（无密码 Magic Link）
            </label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="text-sm"
              />
              <Button type="submit" size="sm" disabled={loading || !email.trim()} className="gap-1.5 shrink-0">
                <Mail className="size-3.5" />
                发送链接
              </Button>
            </div>
          </div>
        </form>

        {/* Quick Options */}
        <div className="mt-4 pt-3 border-t border-border/70 space-y-2">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={handleAnonymous}
              className="w-full gap-1.5 text-xs justify-center"
            >
              <Sparkles className="size-3.5 text-primary" />
              游客即时会话模式
            </Button>
          </div>

          {user && user.id !== "guest-traveler-demo" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={handleLogout}
              className="w-full gap-1.5 text-xs text-rose-600 hover:text-rose-600 hover:bg-rose-500/10 justify-center"
            >
              <LogOut className="size-3.5" />
              退出当前账号
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
