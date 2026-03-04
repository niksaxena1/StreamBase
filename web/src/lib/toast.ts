/**
 * Lightweight imperative toast for action feedback.
 * Mounts a DOM element directly — no React context required.
 */
export function showToast(message: string, variant: "success" | "error" | "info" | "warning" = "success") {
  try {
    const existing = document.getElementById("sb-action-toast");
    if (existing) existing.remove();

    const backgroundColor = (() => {
      switch (variant) {
        case "success": return "#22c55e";
        case "error": return "#ef4444";
        case "info": return "#3b82f6";
        case "warning": return "#f59e0b";
        default: return "#22c55e";
      }
    })();

    const el = document.createElement("div");
    el.id = "sb-action-toast";
    el.setAttribute("role", variant === "error" ? "alert" : "status");
    el.setAttribute("aria-live", variant === "error" ? "assertive" : "polite");
    el.setAttribute("aria-atomic", "true");
    el.style.cssText = `
      position: fixed;
      bottom: calc(88px + env(safe-area-inset-bottom, 0px));
      right: 24px;
      background: ${backgroundColor};
      color: white;
      padding: 10px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 500;
      z-index: 9999;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 200ms ease, transform 200ms ease;
    `;
    document.body.appendChild(el);
    el.textContent = message;

    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });

    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(8px)";
      setTimeout(() => el.remove(), 220);
    }, 2500);
  } catch {
    // ignore toast failures
  }
}
