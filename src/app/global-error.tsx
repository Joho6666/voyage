"use client";

/**
 * Last-resort boundary: when the root layout itself throws, only this page
 * renders. It must own its <html>/<body> and cannot use the design system.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body style={{ alignItems: "center", backgroundColor: "#faf9f7", color: "#1c1917", display: "grid", fontFamily: "system-ui, sans-serif", justifyContent: "center", minHeight: "100dvh", margin: 0 }}>
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Voyage 暂时不可用</h1>
          <p style={{ color: "#57534e", fontSize: 13, lineHeight: "20px" }}>
            应用遇到了未恢复的错误。刷新通常可以解决；你的行程数据保存在服务端，不会因此丢失。
          </p>
          {error.digest ? <p style={{ color: "#a8a29e", fontSize: 10 }}>{error.digest}</p> : null}
          <button
            type="button"
            onClick={reset}
            style={{ backgroundColor: "#1c1917", borderRadius: 10, border: "none", color: "#fff", cursor: "pointer", fontSize: 13, marginTop: 16, padding: "10px 18px" }}
          >
            刷新重试
          </button>
        </div>
      </body>
    </html>
  );
}
