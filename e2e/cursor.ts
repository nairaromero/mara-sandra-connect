import type { Page } from "@playwright/test";

// O Playwright move um ponteiro REAL (page.mouse dispara eventos de input do
// browser), mas o video nao desenha cursor nenhum. Este overlay escuta
// mousemove/mousedown e desenha o ponteiro + um pulso a cada clique.
export async function cursorVisivel(page: Page) {
  await page.addInitScript(() => {
    const montar = () => {
      if (document.getElementById("__pw_cursor")) return;

      const css = document.createElement("style");
      css.textContent = `
        #__pw_cursor{position:fixed;z-index:2147483647;width:22px;height:22px;
          margin:-11px 0 0 -11px;pointer-events:none;left:-100px;top:-100px;
          transition:left .06s linear,top .06s linear}
        #__pw_cursor::before{content:"";position:absolute;inset:0;border-radius:50%;
          background:rgba(220,38,38,.35);border:2px solid #dc2626;box-sizing:border-box}
        .__pw_pulse{position:fixed;z-index:2147483646;width:14px;height:14px;
          margin:-7px 0 0 -7px;border-radius:50%;border:3px solid #dc2626;
          pointer-events:none;animation:__pw_p .5s ease-out forwards}
        @keyframes __pw_p{from{transform:scale(1);opacity:.9}
          to{transform:scale(4.5);opacity:0}}`;
      document.head.appendChild(css);

      const dot = document.createElement("div");
      dot.id = "__pw_cursor";
      document.body.appendChild(dot);

      addEventListener("mousemove", (e) => {
        dot.style.left = e.clientX + "px";
        dot.style.top = e.clientY + "px";
      }, true);

      addEventListener("mousedown", (e) => {
        const p = document.createElement("div");
        p.className = "__pw_pulse";
        p.style.left = e.clientX + "px";
        p.style.top = e.clientY + "px";
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 520);
      }, true);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", montar);
    } else {
      montar();
    }
  });
}
