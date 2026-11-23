/* Diagnose: was kann der Browser auf diesem Gerät? (ohne App-Code, ohne Daten zu ändern;
   legt nur eine kleine Test-Datenbank an und löscht sie wieder) */
(function () {
  var out = document.getElementById("out");
  var rows = [];
  function row(name, val, cls) { rows.push("<tr><td>" + name + "</td><td class='" + (cls || "") + "'>" + String(val).replace(/[<>&]/g, "") + "</td></tr>"); out.innerHTML = rows.join(""); }
  function withTimeout(p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("keine Antwort nach " + ms / 1000 + " s")); }, ms); })]); }
  // create=false: nur vorhandene Datenbank öffnen, nichts anlegen
  function openDb(name, version, create) {
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      var req = version ? indexedDB.open(name, version) : indexedDB.open(name);
      req.onupgradeneeded = function () {
        if (!create) { try { req.transaction.abort(); } catch (e) {} reject(new Error("nicht vorhanden")); return; }
        try { if (!req.result.objectStoreNames.contains("t")) req.result.createObjectStore("t"); } catch (e) {}
      };
      req.onsuccess = function () { resolve({ db: req.result, ms: Date.now() - t0 }); };
      req.onerror = function () { reject(req.error && req.error.name !== "AbortError" ? req.error : new Error("nicht vorhanden")); };
      req.onblocked = function () { row("  → blockiert", "andere Verbindung hält die Datenbank offen", "warn"); };
    });
  }
  (async function () {
    row("Browser", navigator.userAgent);
    row("Seite", location.href);
    row("Als App (Startbildschirm)", (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone) ? "ja" : "nein");
    try { localStorage.setItem("diag", "1"); localStorage.removeItem("diag"); row("localStorage", "ok", "ok"); } catch (e) { row("localStorage", e.message, "bad"); }
    row("indexedDB vorhanden", typeof indexedDB !== "undefined" ? "ja" : "NEIN", typeof indexedDB !== "undefined" ? "ok" : "bad");
    if (typeof indexedDB === "undefined") return;
    try {
      if (indexedDB.databases) {
        var t0 = Date.now();
        var dbs = await withTimeout(indexedDB.databases(), 5000);
        row("indexedDB.databases()", (Date.now() - t0) + " ms: " + (dbs.map(function (d) { return d.name + " v" + d.version; }).join(", ") || "keine"), "ok");
      } else row("indexedDB.databases()", "nicht vorhanden", "warn");
    } catch (e) { row("indexedDB.databases()", e.message, "bad"); }
    // neue Test-Datenbank
    try {
      var r = await withTimeout(openDb("stahlwork_diag", 1, true), 8000);
      row("Neue Test-Datenbank öffnen", r.ms + " ms", "ok");
      await withTimeout(new Promise(function (res, rej) { var tx = r.db.transaction("t", "readwrite"); tx.objectStore("t").put({ a: 1, b: new Blob(["x"]) }, "k"); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; }), 5000);
      row("  → schreiben (mit Blob)", "ok", "ok");
      r.db.close();
      indexedDB.deleteDatabase("stahlwork_diag");
    } catch (e) { row("Neue Test-Datenbank öffnen", e.message, "bad"); }
    // App-Datenbank (nur lesen)
    var names = ["baudoc_db_v1"];
    try { var alt = localStorage.getItem("stahlwork-db"); if (alt) names.push(alt); } catch (e) {}
    for (var i = 0; i < names.length; i++) {
      try {
        var a = await withTimeout(openDb(names[i], 0, false), 8000);
        row("App-Speicher " + names[i], "geöffnet in " + a.ms + " ms, Version " + a.db.version + ", Bereiche: " + Array.prototype.join.call(a.db.objectStoreNames, ", "), "ok");
        try {
          var st = await withTimeout(new Promise(function (res, rej) { var q = a.db.transaction("kv", "readonly").objectStore("kv").get("state"); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; }), 8000);
          var n = st && st.projects ? st.projects.length : 0;
          row("  → Zustand lesen", st ? "ok, " + n + " Bauvorhaben, Version " + (st.version || "?") : "leer", "ok");
        } catch (e) { row("  → Zustand lesen", e.message, "bad"); }
        a.db.close();
      } catch (e) { row("App-Speicher " + names[i], e.message, "bad"); }
    }
    try {
      if (navigator.storage && navigator.storage.estimate) {
        var est = await withTimeout(navigator.storage.estimate(), 5000);
        row("Speicher belegt / frei", Math.round((est.usage || 0) / 1e6) + " MB von " + Math.round((est.quota || 0) / 1e6) + " MB");
      }
      if (navigator.storage && navigator.storage.persisted) row("Speicher dauerhaft", (await withTimeout(navigator.storage.persisted(), 5000)) ? "ja" : "nein");
    } catch (e) { row("Speicher-Info", e.message, "warn"); }
    try {
      row("Service Worker aktiv", navigator.serviceWorker && navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : "nein");
      if (window.caches) row("Offline-Speicher", (await withTimeout(caches.keys(), 5000)).join(", ") || "leer");
    } catch (e) { row("Offline-Speicher", e.message, "warn"); }
    row("Fertig", new Date().toLocaleString("de-DE"), "ok");
  })();
})();
