/* Startwächter (klassisches Skript, läuft vor der App):
   Startet die App nicht (z. B. halb aktualisierter Offline-Speicher nach einem Update),
   erscheint nach kurzer Zeit ein Hinweis mit "Neu laden". Dabei wird nur der
   Offline-Speicher der App-Dateien erneuert – die eigenen Daten bleiben erhalten. */
(function () {
  var shown = false;
  function repair() {
    var done = function () { location.reload(); };
    var jobs = [];
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
      }
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return /^(stahlwork|baudoc)-/.test(k); }).map(function (k) { return caches.delete(k); })); }));
      }
    } catch (e) {}
    Promise.all(jobs).then(done, done);
    setTimeout(done, 3000);
  }
  function show(reason) {
    if (shown || window.__appReady) return;
    shown = true;
    var app = document.getElementById("app");
    if (!app) return;
    app.innerHTML = '<div class="card boot-fail"><h3>Stahlwork startet nicht</h3>' +
      '<p class="muted">Vermutlich wurde ein Update nicht vollständig geladen. Deine Daten bleiben erhalten.</p>' +
      '<button class="primary" type="button" id="bootRepair">Neu laden</button>' +
      (reason ? '<p class="muted" style="margin-top:10px;font-size:.75rem">' + String(reason).replace(/[<>&]/g, "") + '</p>' : "") + "</div>";
    document.getElementById("bootRepair").onclick = function () { this.disabled = true; this.textContent = "Wird neu geladen …"; repair(); };
  }
  window.__bootShow = show;
  // Fehler beim Laden der App-Module
  window.addEventListener("error", function (e) {
    if (window.__appReady) return;
    var t = e && e.target;
    if (t && t.tagName === "SCRIPT") show("Datei konnte nicht geladen werden: " + (t.src || ""));
    else if (e && e.message) show(e.message);
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    if (!window.__appReady) show(e && e.reason && (e.reason.message || e.reason));
  });
  // Start dauert zu lange
  setTimeout(function () { show("Zeitüberschreitung beim Start"); }, 12000);
})();
