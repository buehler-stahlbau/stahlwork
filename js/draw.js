/* =========================================================
   Foto markieren: mit dem Stift ins Bild zeichnen (Vollbild)
   editImage(blob) -> neues Bild (Blob, JPG) oder null (abgebrochen)
   Zwei Ebenen: Foto (unten, unverändert) + Markierungen (oben).
   Der Radiergummi entfernt nur Markierungen, nie das Foto.
========================================================= */
const COLORS = [
  { c: "#e0261b", n: "Rot" },
  { c: "#39d353", n: "Grün" },
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
        <div class="draw-tools">
          ${COLORS.map((x, i) => `<button type="button" class="draw-col ${i === 0 ? "on" : ""}" data-c="${x.c}" title="${x.n}" aria-label="Stift ${x.n}" style="--c:${x.c}"></button>`).join("")}
          <button type="button" class="draw-eraser" title="Radiergummi (entfernt nur Markierungen)" aria-label="Radiergummi"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 20h13"/><path d="M4.5 14.5l9-9a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L11 20H8z"/><path d="M9 10l5.5 5.5"/></svg></button>
          <span class="draw-sep"></span>
          ${SIZES.map((x, i) => `<button type="button" class="draw-size ${i === 1 ? "on" : ""}" data-s="${i}" title="${x.n}" aria-label="Strich ${x.n}"><i style="--d:${4 + i * 4}px"></i></button>`).join("")}
          <span class="draw-sep"></span>
          <button type="button" class="draw-undo" title="Rückgängig" aria-label="Rückgängig" disabled><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg></button>
        </div>
        <div class="draw-acts"><button type="button" class="secondary draw-cancel">Abbrechen</button><button type="button" class="primary draw-save">Speichern</button></div>
        <div class="draw-stage"><div class="draw-canvas"><canvas class="base" width="${W}" height="${H}"></canvas><canvas class="ink" width="${W}" height="${H}"></canvas></div></div>`;
      document.body.appendChild(wrap);
      document.body.classList.add("modal-open");
      const base = wrap.querySelector("canvas.base"), cv = wrap.querySelector("canvas.ink");
      base.getContext("2d").drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      const ctx = cv.getContext("2d");
      // ins Fenster einpassen
      const stage = wrap.querySelector(".draw-stage"), box = wrap.querySelector(".draw-canvas");
      const fitCanvas = () => {
        const r = stage.getBoundingClientRect();
        const k = Math.min(r.width / W, r.height / H);
        box.style.width = `${Math.floor(W * k)}px`; box.style.height = `${Math.floor(H * k)}px`;
      };
      fitCanvas();
      window.addEventListener("resize", fitCanvas);

      let color = COLORS[0].c, size = SIZES[1].f, erase = false;
      const strokes = []; // für Rückgängig: Stand der Markierungen vor jedem Strich
      let drawn = false;
      const undoBtn = wrap.querySelector(".draw-undo"), eraserBtn = wrap.querySelector(".draw-eraser");
      const setTool = (er, btn) => {
        erase = er;
        wrap.querySelectorAll(".draw-col, .draw-eraser").forEach((x) => x.classList.toggle("on", x === btn));
      };
      wrap.querySelectorAll(".draw-col").forEach((b) => { b.onclick = () => { color = b.dataset.c; setTool(false, b); }; });
      eraserBtn.onclick = () => setTool(true, eraserBtn);
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
        drawn = true;
        const [x, y] = pos(ev);
        ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
        ctx.strokeStyle = color; ctx.fillStyle = color;
        ctx.lineWidth = Math.max(2, Math.round(Math.max(W, H) * size * (erase ? 2.5 : 1))); // Radiergummi etwas breiter
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
      const cancel = () => { if (drawn && !confirm("Markierungen verwerfen?")) return; close(null); };
      const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
      document.addEventListener("keydown", onKey, true);
      wrap.querySelector(".draw-cancel").onclick = cancel;
      wrap.querySelector(".draw-save").onclick = () => {
        if (!drawn) { close(null); return; } // nichts gezeichnet
        // Foto + Markierungen zusammenführen
        const out = document.createElement("canvas"); out.width = W; out.height = H;
        const o = out.getContext("2d"); o.drawImage(base, 0, 0); o.drawImage(cv, 0, 0);
        out.toBlob((b) => close(b), "image/jpeg", 0.9);
      };
    };
    img.src = url;
  });
}
