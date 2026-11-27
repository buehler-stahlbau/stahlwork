/* =========================================================
   Foto markieren: mit dem Stift ins Bild zeichnen (Vollbild)
   editImage(blob) -> neues Bild (Blob, JPG) oder null (abgebrochen)
========================================================= */
const COLORS = [
  { c: "#e0261b", n: "Rot" },
  { c: "#ffd400", n: "Gelb" },
  { c: "#111111", n: "Schwarz" },
  { c: "#ffffff", n: "Weiß" },
];
const SIZES = [{ f: 0.004, n: "fein" }, { f: 0.008, n: "mittel" }, { f: 0.016, n: "dick" }];
const MAX_DIM = 2600; // Zeichenfläche (lange Seite) – reicht für die Ablage, schont den Speicher am Handy

export function editImage(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.onload = () => {
      const s = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      const W = Math.round(img.naturalWidth * s), H = Math.round(img.naturalHeight * s);
      const wrap = document.createElement("div");
      wrap.className = "draw-modal";
      wrap.innerHTML = `
        <div class="draw-bar">
          <div class="draw-tools">
            ${COLORS.map((x, i) => `<button type="button" class="draw-col ${i === 0 ? "on" : ""}" data-c="${x.c}" title="${x.n}" aria-label="Farbe ${x.n}" style="--c:${x.c}"></button>`).join("")}
            <span class="draw-sep"></span>
            ${SIZES.map((x, i) => `<button type="button" class="draw-size ${i === 1 ? "on" : ""}" data-s="${i}" title="${x.n}" aria-label="Strich ${x.n}"><i style="--d:${4 + i * 4}px"></i></button>`).join("")}
            <span class="draw-sep"></span>
            <button type="button" class="draw-undo" title="Rückgängig" aria-label="Rückgängig" disabled><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg></button>
          </div>
          <div class="draw-acts"><button type="button" class="secondary draw-cancel">Abbrechen</button><button type="button" class="primary draw-save">Speichern</button></div>
        </div>
        <div class="draw-stage"><canvas width="${W}" height="${H}"></canvas></div>`;
      document.body.appendChild(wrap);
      document.body.classList.add("modal-open");
      const cv = wrap.querySelector("canvas");
      const ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      // Bildschirmgröße: ins Fenster einpassen
      const stage = wrap.querySelector(".draw-stage");
      const fitCanvas = () => {
        const r = stage.getBoundingClientRect();
        const k = Math.min(r.width / W, r.height / H);
        cv.style.width = `${Math.floor(W * k)}px`; cv.style.height = `${Math.floor(H * k)}px`;
      };
      fitCanvas();
      window.addEventListener("resize", fitCanvas);

      let color = COLORS[0].c, size = SIZES[1].f;
      const strokes = []; // für Rückgängig: Bildstand vor jedem Strich
      const undoBtn = wrap.querySelector(".draw-undo");
      wrap.querySelectorAll(".draw-col").forEach((b) => { b.onclick = () => { color = b.dataset.c; wrap.querySelectorAll(".draw-col").forEach((x) => x.classList.toggle("on", x === b)); }; });
      wrap.querySelectorAll(".draw-size").forEach((b) => { b.onclick = () => { size = SIZES[+b.dataset.s].f; wrap.querySelectorAll(".draw-size").forEach((x) => x.classList.toggle("on", x === b)); }; });
      undoBtn.onclick = () => { const last = strokes.pop(); if (last) ctx.putImageData(last, 0, 0); undoBtn.disabled = !strokes.length; };

      let drawing = null;
      const pos = (ev) => { const r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) * (W / r.width), (ev.clientY - r.top) * (H / r.height)]; };
      cv.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        try { cv.setPointerCapture(ev.pointerId); } catch {}
        if (strokes.length >= 20) strokes.shift();
        strokes.push(ctx.getImageData(0, 0, W, H));
        undoBtn.disabled = false;
        const [x, y] = pos(ev);
        ctx.strokeStyle = color; ctx.fillStyle = color;
        ctx.lineWidth = Math.max(2, Math.round(Math.max(W, H) * size));
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.beginPath(); ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x, y);
        drawing = ev.pointerId;
      });
      cv.addEventListener("pointermove", (ev) => {
        if (drawing !== ev.pointerId) return;
        ev.preventDefault();
        const pts = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
        for (const p of pts.length ? pts : [ev]) { const [x, y] = pos(p); ctx.lineTo(x, y); }
        ctx.stroke();
      });
      const end = (ev) => { if (drawing === ev.pointerId) drawing = null; };
      cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);

      const close = (result) => {
        window.removeEventListener("resize", fitCanvas);
        document.removeEventListener("keydown", onKey, true);
        wrap.remove();
        document.body.classList.remove("modal-open");
        resolve(result);
      };
      const cancel = () => { if (strokes.length && !confirm("Markierungen verwerfen?")) return; close(null); };
      const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
      document.addEventListener("keydown", onKey, true);
      wrap.querySelector(".draw-cancel").onclick = cancel;
      wrap.querySelector(".draw-save").onclick = () => {
        if (!strokes.length) { close(null); return; } // nichts gezeichnet
        cv.toBlob((b) => close(b), "image/jpeg", 0.9);
      };
    };
    img.src = url;
  });
}
