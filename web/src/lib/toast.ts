/**
 * Lightweight imperative toast for action feedback.
 * Mounts a DOM element directly — no React context required.
 */
export function showToast(message: string, variant: "success" | "error" = "success") {
  try {
    const existing = document.getElementById("sb-action-toast");
    if (existing) existing.remove();

    const el = document.createElement("div");
    el.id = "sb-action-toast";
    el.textContent = message;
    el.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: ${variant === "success" ? "#22c55e" : "#ef4444"};
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
