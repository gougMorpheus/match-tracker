#!/usr/bin/env python3
"""Erzeugt src/battle-cal/battle-cal.html aus dem Original gougMorpheus/battle-cal index.html (Commit a8ce471).
Aufruf: python3 tools/battle-cal/patch-original.py <original-index.html> <ziel.html>
Jede Ersetzung muss genau einmal passen, sonst Abbruch (so faellt eine geaenderte Vorlage sofort auf)."""
import sys, re

src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf-8").read()

def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit(f"Ersetzung passt {n}x statt {count}x: {old[:90]!r}")
    s = s.replace(old, new)

def rep_re(pattern, new):
    global s
    found = re.findall(pattern, s)
    if len(found) != 1: sys.exit(f"Muster passt {len(found)}x: {pattern[:80]!r}")
    s = re.sub(pattern, lambda m: new, s)

def rep_block(start, end, new):
    """Ersetzt den Block von 'start' (inkl.) bis vor 'end' (exkl.)."""
    global s
    if s.count(start) != 1: sys.exit(f"Blockanfang passt {s.count(start)}x: {start[:80]!r}")
    i = s.index(start); j = s.index(end, i)
    s = s[:i] + new + s[j:]

# ---------- Kopf: Titel, Schalter, Konfiguration ----------
rep("<title>40K Battle Calculator</title>",
    "<title>Battle-Cal – Match-Tracker</title>\n  <meta name=\"robots\" content=\"noindex\" />")

GATE = r'''<script>
    // Match-Tracker: Battle-Cal hinter dem Schalter (Standard AUS). Gleicher Schalter wie die App (localStorage, Origin des Match-Trackers).
    (() => {
      const KEY = "match-tracker.feature.battle-cal";
      try {
        const q = new URLSearchParams(window.location.search || "").get("battlecal");
        if (q === "1") localStorage.setItem(KEY, "1");
        else if (q === "0") localStorage.removeItem(KEY);
        window.__BC_ENABLED = localStorage.getItem(KEY) === "1";
      } catch { window.__BC_ENABLED = false; }
      window.__BC_EMBEDDED = window.top !== window;
      // UX-Befund B: eingebettet im Match-Tracker (gleiche Origin) Hintergrund durchsichtig und den iframe bis zum unteren
      // Fensterrand ziehen. Dann scrollt nur Battle-Cal, und die feste Leiste unten ("Berechnen") ist sichtbar.
      if (!window.__BC_EMBEDDED || !window.__BC_ENABLED) return;
      let frame = null;
      try { frame = window.frameElement; } catch { frame = null; }
      if (!frame) return;
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
      frame.style.background = "transparent";
      frame.style.colorScheme = "dark";
      const host = window.parent;
      const fit = () => {
        try {
          if (!frame.isConnected) return;
          const top = frame.getBoundingClientRect().top + host.scrollY;
          frame.style.minHeight = "320px";
          frame.style.height = `${Math.max(320, Math.floor(host.innerHeight - top - 12))}px`;
        } catch {}
      };
      fit();
      // nach Schriften/Layout der Huelle nochmals messen
      window.addEventListener("load", fit);
      setTimeout(fit, 300);
      setTimeout(fit, 1200);
      host.addEventListener("resize", fit);
      window.addEventListener("pagehide", () => { try { host.removeEventListener("resize", fit); } catch {} });
    })();
  </script>
'''
rep("<body>\n  <div class=\"container\">", "<body>\n  " + GATE + '''  <div id="bcDisabledNote" class="container" hidden>
    <section class="card panel"><h2>Battle-Cal</h2><div class="note-box">Battle-Cal ist auf diesem Gerät noch nicht freigeschaltet.
      <a href="/">Zum Match-Tracker</a></div></section>
  </div>
  <div id="bcStandaloneBar" class="container" hidden>
    <div class="note-box"><a href="/">← Match-Tracker</a></div>
  </div>
  <div class="container" id="bcAppRoot">''')

rep('''      const SUPABASE_URL = "https://rgvpxnmbuyxqplsfonzm.supabase.co";
      const SUPABASE_KEY = "sb_publishable_iUwn_cBLDcPrAaiof1S5hg_FucelzvH";''',
    '''      // Match-Tracker-Projekt; beim Build eingesetzt (vite.config.ts, aus VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).
      const SUPABASE_URL = "__BC_SUPABASE_URL__";
      const SUPABASE_KEY = "__BC_SUPABASE_KEY__";
      // Umzug: lokale Daten der alten Site (battle-cal.netlify.app) per postMessage uebernehmen.
      const UMZUG_SOURCE_ORIGINS = ["https://battle-cal.netlify.app"];''')

rep('''(() => {
      "use strict";
''', '''(() => {
      "use strict";
      if (!window.__BC_ENABLED) {
        document.getElementById("bcAppRoot").hidden = true;
        document.getElementById("bcDisabledNote").hidden = false;
        return;
      }
      if (!window.__BC_EMBEDDED) document.getElementById("bcStandaloneBar").hidden = false;
''')

# ---------- Zustand: Passwort nur im Arbeitsspeicher ----------
rep('''      let cloudProfile = loadCloudProfile();''', '''      let cloudProfile = loadCloudProfile();
      // Profil-Passwort NUR im Arbeitsspeicher dieser Seite (nie localStorage/sessionStorage); weg nach Neuladen oder Profilwechsel.
      let cloudProfilePassword = "";
      let armyUnitRowsById = new Map();
      let armyWeaponRowsById = new Map();
      let armyRosterLoads = new Map();''')

# ---------- Profil-Dialog ----------
rep('''            <label for="cloudProfilePassword">Löschpasswort</label>
            <input id="cloudProfilePassword" type="password" autocomplete="new-password" placeholder="für Profil löschen" />''',
    '''            <label for="cloudProfilePassword">Profil-Passwort</label>
            <input id="cloudProfilePassword" type="password" autocomplete="new-password" placeholder="zum Speichern, Umbenennen und Löschen" />''')

# ---------- Profile ----------
rep('''      async function selectCloudProfile(selectedId) {
        cloudProfile = cloudProfiles.find(profile => profile.id === selectedId) || null;''',
    '''      async function selectCloudProfile(selectedId) {
        cloudProfile = cloudProfiles.find(profile => profile.id === selectedId) || null;
        cloudProfilePassword = "";''')

rep('''        const profiles = await supabaseRequest("/rest/v1/battle_profiles?select=id,name,delete_password,created_at&order=name.asc");
        cloudProfiles = Array.isArray(profiles) ? profiles : [];''',
    '''        const profiles = await bcRpc("bc_profiles_list");
        cloudProfiles = Array.isArray(profiles) ? profiles.map(publicProfile) : [];''')

rep('''          showToast("Löschpasswort fehlt.");''', '''          showToast("Profil-Passwort fehlt.");''')
rep('''          const [profile] = await supabaseRequest("/rest/v1/battle_profiles?select=id,name,delete_password,created_at", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({ name, delete_password: deletePassword })
          });
          cloudProfile = profile;''',
    '''          const profile = await bcRpc("bc_profile_create", { p_name: name, p_password: deletePassword });
          cloudProfile = publicProfile(profile);
          cloudProfilePassword = deletePassword;''')
rep('''          showToast(`Cloud-Profil ${name} aktiv.`);
        } catch {
          updateSyncStatus("error", "Profil konnte nicht angelegt werden.");
          showToast("Cloud-Profil konnte nicht angelegt werden.");''',
    '''          showToast(`Cloud-Profil ${name} aktiv.`);
        } catch (error) {
          updateSyncStatus("error", "Profil konnte nicht angelegt werden.");
          showToast(error?.kind === "conflict" ? "Profilname ist schon vergeben." : "Cloud-Profil konnte nicht angelegt werden.");''')

rep('''        try {
          updateSyncStatus("loading");
          const [profile] = await supabaseRequest(`/rest/v1/battle_profiles?id=eq.${encodeURIComponent(cloudProfile.id)}&select=id,name,delete_password,created_at`, {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({ name })
          });
          cloudProfile = profile;''',
    '''        const password = !profileHasPassword(cloudProfile) ? "" : (cloudProfilePassword || await requestPassword(`Cloud-Profil "${cloudProfile.name}" umbenennen`, "Profil-Passwort oder Admin-Passwort"));
        if (password === null) return;
        try {
          updateSyncStatus("loading");
          const profile = await bcRpc("bc_profile_rename", { p_profile_id: cloudProfile.id, p_password: password, p_name: name });
          cloudProfile = publicProfile(profile);''')
rep('''          showToast("Cloud-Profil umbenannt.");
        } catch {
          updateSyncStatus("error", "Profil konnte nicht umbenannt werden.");
          showToast("Cloud-Profil konnte nicht umbenannt werden.");''',
    '''          showToast("Cloud-Profil umbenannt.");
        } catch (error) {
          updateSyncStatus("error", "Profil konnte nicht umbenannt werden.");
          showToast(error?.kind === "forbidden" ? "Passwort ist falsch." : error?.kind === "conflict" ? "Profilname ist schon vergeben." : "Cloud-Profil konnte nicht umbenannt werden.");''')

# Loeschen: Master-Passwort entfaellt; Server prueft Profil- oder Admin-Passwort.
# (Das fest eingebaute Master-Passwort des Originals wird per Muster erkannt und steht bewusst NICHT in diesem Skript.)
rep_re(r'''        const password = window\.prompt\(`Löschpasswort für Cloud-Profil "\$\{name\}":`\);
        if \(password === null\) return;
        const storedPassword = cloudProfile\.delete_password \|\| "";
        if \(password !== "[^"\n]*" && password !== storedPassword\) \{
          showToast\("Löschpasswort ist falsch\."\);
          return;
        \}
        if \(!window\.confirm''',
    '''        const password = await requestPassword(`Cloud-Profil "${name}" löschen`, profileHasPassword(cloudProfile) ? "Profil-Passwort oder Admin-Passwort" : "Profil ohne Passwort: nur mit Admin-Passwort");
        if (!password) return;
        if (!window.confirm''')
rep('''          await supabaseRequest(`/rest/v1/battle_profiles?id=eq.${encodeURIComponent(cloudProfile.id)}`, {
            method: "DELETE"
          });
          cloudProfile = null;''',
    '''          await bcRpc("bc_profile_delete", { p_profile_id: cloudProfile.id, p_password: password });
          cloudProfile = null;
          cloudProfilePassword = "";''')
rep('''          showToast(`Cloud-Profil ${name} gelöscht.`);
        } catch {''', '''          showToast(`Cloud-Profil ${name} gelöscht.`);
        } catch (error) {
          if (error?.kind === "forbidden") {
            updateSyncStatus();
            showToast("Passwort ist falsch.");
            return;
          }''')

# ---------- Profile ohne Passwort (Migration 03): Speichern ohne Abfrage, Passwort setzen/aendern ----------
rep('''            <button type="button" id="cloudProfileRenameBtn">Umbenennen</button>''',
    '''            <button type="button" id="cloudProfileRenameBtn">Umbenennen</button>
            <button type="button" id="cloudProfilePasswordBtn">Passwort setzen</button>''')
rep('''        cloudProfileRenameBtn: document.getElementById("cloudProfileRenameBtn"),''',
    '''        cloudProfileRenameBtn: document.getElementById("cloudProfileRenameBtn"),
        cloudProfilePasswordBtn: document.getElementById("cloudProfilePasswordBtn"),''')
rep('''        ids.cloudProfileRenameBtn.addEventListener("click", async () => {
          await renameCloudProfile();
        });''',
    '''        ids.cloudProfileRenameBtn.addEventListener("click", async () => {
          await renameCloudProfile();
        });

        ids.cloudProfilePasswordBtn.addEventListener("click", async () => {
          await setCloudProfilePassword();
        });''')
rep('''        ids.cloudProfileRenameBtn.disabled = !cloudProfile;
        ids.cloudProfileDeleteBtn.disabled = !cloudProfile;''',
    '''        ids.cloudProfileRenameBtn.disabled = !cloudProfile;
        ids.cloudProfileDeleteBtn.disabled = !cloudProfile;
        updateProfilePasswordButton();
      }

      function updateProfilePasswordButton() {
        ids.cloudProfileRenameBtn.disabled = !cloudProfile;
        ids.cloudProfileDeleteBtn.disabled = !cloudProfile;
        ids.cloudProfilePasswordBtn.disabled = !cloudProfile;
        ids.cloudProfilePasswordBtn.textContent = cloudProfile && !profileHasPassword(cloudProfile) ? "Passwort setzen" : "Passwort ändern";''')
rep('''        cloudProfilePassword = "";
        saveCloudProfile();
        updateSyncStatus("loading");''', '''        cloudProfilePassword = "";
        updateProfilePasswordButton();
        saveCloudProfile();
        updateSyncStatus("loading");''')
rep('''      async function deleteCloudProfile() {''',
    '''      // Profil ohne Passwort (wie im Original): Passwort frei setzen. Mit Passwort: altes oder Admin-Passwort noetig.
      async function setCloudProfilePassword() {
        if (!cloudProfile) {
          showToast("Kein Cloud-Profil ausgewählt.");
          return;
        }
        const hadPassword = profileHasPassword(cloudProfile);
        let oldPassword = "";
        if (hadPassword) {
          // Immer neu abfragen, nie das gemerkte Sitzungs-Passwort als Ersatz nehmen (sonst keine echte Pruefung des alten Passworts).
          oldPassword = await requestPassword(`Passwort für "${cloudProfile.name}" ändern`, "Bisheriges Profil-Passwort oder Admin-Passwort");
          if (!oldPassword) return;
        }
        const nextPassword = await requestPassword(`Neues Passwort für "${cloudProfile.name}"`, "Danach wird es zum Speichern, Umbenennen und Löschen gebraucht.");
        if (!nextPassword) return;
        const repeated = await requestPassword("Neues Passwort wiederholen", "Zur Kontrolle noch einmal eingeben.");
        if (repeated === null) return;
        if (repeated !== nextPassword) {
          showToast("Passwörter stimmen nicht überein.");
          return;
        }
        try {
          updateSyncStatus("loading");
          const profile = await bcRpc("bc_profile_set_password", { p_profile_id: cloudProfile.id, p_password: oldPassword, p_new_password: nextPassword });
          cloudProfile = publicProfile(profile);
          cloudProfilePassword = nextPassword;
          await loadCloudProfiles();
          renderCloudProfiles();
          saveCloudProfile();
          markSynced();
          showToast(hadPassword ? "Passwort geändert." : "Passwort gesetzt.");
        } catch (error) {
          updateSyncStatus("error", "Passwort konnte nicht gesetzt werden.");
          // Falsches altes Passwort: gemerktes Sitzungs-Passwort bleibt unveraendert (nicht leeren, nicht mit dem neuen ueberschreiben).
          showToast(cloudErrorText(error, "Passwort konnte nicht gesetzt werden."));
        }
      }

      async function deleteCloudProfile() {''')
# ---------- Historie ----------
rep('''          const rows = await supabaseRequest(`/rest/v1/battle_results?select=id,created_at,custom_title,inputs,outputs&profile_id=eq.${encodeURIComponent(cloudProfile.id)}&order=created_at.desc&limit=${HISTORY_LIMIT}`);''',
    '''          const rows = await bcRpc("bc_results_list", { p_profile_id: cloudProfile.id, p_limit: HISTORY_LIMIT }) || [];''')

rep_block('''      async function pushLocalHistoryToCloud() {''', '''      function isMissingWeaponRoleError(error) {''', r'''      async function pushLocalHistoryToCloud(entries = historyEntries) {
        if (!cloudProfile || !entries.length) return;
        try {
          updateSyncStatus("loading");
          for (const chunk of chunkArray(entries, 200)) {
            await withProfilePassword(password => bcRpc("bc_results_upsert_many", {
              p_profile_id: cloudProfile.id, p_password: password, p_results: chunk.map(cloudResultPayload)
            }));
          }
          markSynced();
        } catch (error) {
          updateSyncStatus("error", "Cloud-Speichern fehlgeschlagen.");
          showToast(cloudErrorText(error, "Cloud-Speichern fehlgeschlagen."));
        }
      }

      function cloudResultPayload(entry) {
        return {
          id: entry.id,
          created_at: entry.createdAt,
          custom_title: entry.customTitle || "",
          inputs: entry.inputs,
          outputs: entry.outputs
        };
      }

      async function syncCloudEntry(entry, options = {}) {
        if (!cloudProfile || typeof fetch !== "function") return;
        try {
          updateSyncStatus("loading");
          await withProfilePassword(password => bcRpc("bc_result_upsert", {
            p_profile_id: cloudProfile.id, p_password: password, p_result: cloudResultPayload(entry)
          }));
          markSynced();
        } catch (error) {
          updateSyncStatus("error", "Cloud-Speichern fehlgeschlagen.");
          if (!options.silent) showToast(cloudErrorText(error, "Cloud-Speichern fehlgeschlagen."));
        }
      }

      async function deleteCloudEntry(id) {
        if (!cloudProfile || typeof fetch !== "function") return;
        try {
          updateSyncStatus("loading");
          await withProfilePassword(password => bcRpc("bc_result_delete", { p_profile_id: cloudProfile.id, p_password: password, p_result_id: id }));
          markSynced();
        } catch (error) {
          updateSyncStatus("error", "Cloud-Löschen fehlgeschlagen.");
          showToast(cloudErrorText(error, "Cloud-Löschen fehlgeschlagen."));
        }
      }

      async function clearCloudHistory() {
        if (!cloudProfile || typeof fetch !== "function") return;
        try {
          updateSyncStatus("loading");
          await withProfilePassword(password => bcRpc("bc_results_clear", { p_profile_id: cloudProfile.id, p_password: password }));
          markSynced();
        } catch (error) {
          updateSyncStatus("error", "Cloud-Historie konnte nicht gelöscht werden.");
          showToast(cloudErrorText(error, "Cloud-Historie konnte nicht gelöscht werden."));
        }
      }

      // ---------- Match-Tracker: Datenzugriff NUR ueber public.bc_* (RPC), nie direkt auf Tabellen ----------
      async function bcRpc(name, args = {}) {
        if (!/^bc_[a-z_]+$/.test(name)) throw new Error("Ungültige Funktion");
        if (!SUPABASE_URL || SUPABASE_URL.startsWith("__") || !SUPABASE_KEY || SUPABASE_KEY.startsWith("__")) {
          throw Object.assign(new Error("Cloud ist nicht konfiguriert."), { kind: "config" });
        }
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(args)
        });
        const text = await response.text().catch(() => "");
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        if (!response.ok) {
          let kind = "";
          try { kind = JSON.parse(data?.details || "{}").kind || ""; } catch {}
          throw Object.assign(new Error(data?.message || `Supabase ${response.status}`), { kind, status: response.status });
        }
        return data;
      }

      function publicProfile(profile) {
        if (!profile || typeof profile !== "object" || !profile.id) return null;
        return { id: String(profile.id), name: String(profile.name || ""), created_at: profile.created_at || null, has_password: profile.has_password !== false };
      }

      // Nur ein ausdrueckliches has_password=false gilt als "ohne Passwort" (sonst sicherheitshalber mit Abfrage).
      function profileHasPassword(profile) {
        return !profile || profile.has_password !== false;
      }

      function cloudErrorText(error, fallback) {
        if (error?.kind === "cancelled") return "Abgebrochen – nicht in der Cloud gespeichert.";
        if (error?.kind === "forbidden") return "Passwort ist falsch.";
        if (error?.kind === "not_found") return "Nicht gefunden (Profil oder Armee gelöscht?).";
        if (error?.kind === "invalid" && error?.message) return error.message;
        return fallback;
      }

      // Profil-Passwort fuer Schreiben: einmal pro Sitzung abfragen, serverseitig pruefen, nur im Speicher halten.
      async function ensureProfilePassword() {
        if (!cloudProfile) throw Object.assign(new Error("Kein Cloud-Profil"), { kind: "not_found" });
        if (!profileHasPassword(cloudProfile)) return "";  // Profil ohne Passwort: Speichern ohne Abfrage (wie im Original)
        if (cloudProfilePassword) return cloudProfilePassword;
        const password = await requestPassword(`Profil-Passwort für "${cloudProfile.name}"`, "Zum Speichern in der Cloud. Wird nur bis zum Neuladen der Seite gemerkt.");
        if (!password) throw Object.assign(new Error("Abgebrochen"), { kind: "cancelled" });
        await bcRpc("bc_profile_check", { p_profile_id: cloudProfile.id, p_password: password });
        cloudProfilePassword = password;
        return password;
      }

      async function withProfilePassword(action) {
        const password = await ensureProfilePassword();
        try {
          return await action(password);
        } catch (error) {
          if (error?.kind === "forbidden" && password === "" && cloudProfile) {
            // Inzwischen wurde ein Passwort gesetzt (anderes Geraet): ab jetzt abfragen.
            cloudProfile = { ...cloudProfile, has_password: true };
            renderCloudProfiles();
          }
          if (error?.kind === "forbidden" && password === cloudProfilePassword) cloudProfilePassword = "";
          throw error;
        }
      }

      let passwordPrompt = null;
      function requestPassword(title, hint) {
        if (passwordPrompt) return passwordPrompt;
        passwordPrompt = new Promise(resolve => {
          const overlay = document.createElement("div");
          overlay.className = "modal-overlay show";
          overlay.style.zIndex = "60";
          overlay.setAttribute("aria-hidden", "false");
          overlay.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="bcPasswordTitle">
              <div class="modal-head">
                <div>
                  <h2 id="bcPasswordTitle">${escapeHtml(title)}</h2>
                  <div class="muted">${escapeHtml(hint || "")}</div>
                </div>
              </div>
              <div class="stack">
                <div class="field">
                  <label for="bcPasswordInput">Passwort</label>
                  <input id="bcPasswordInput" type="password" autocomplete="current-password" />
                </div>
                <div class="button-row core-actions">
                  <button type="button" class="primary" data-password-action="ok">OK</button>
                  <button type="button" data-password-action="cancel">Abbrechen</button>
                </div>
              </div>
            </div>`;
          document.body.appendChild(overlay);
          const input = overlay.querySelector("input");
          const done = value => {
            overlay.remove();
            passwordPrompt = null;
            resolve(value ? String(value) : null);
          };
          overlay.querySelector('[data-password-action="ok"]').addEventListener("click", () => done(input.value));
          overlay.querySelector('[data-password-action="cancel"]').addEventListener("click", () => done(null));
          input.addEventListener("keydown", event => {
            if (event.key === "Enter") { event.preventDefault(); done(input.value); }
            if (event.key === "Escape") done(null);
          });
          setTimeout(() => input.focus(), 0);
        });
        return passwordPrompt;
      }

''')

# ---------- Armeen ----------
rep_block('''      async function saveImportedArmyRoster(extracted) {''', '''      function collectTopLevelRosterUnits(roster) {''', r'''      async function saveImportedArmyRoster(extracted) {
        // Ersetzt die Armee in EINEM Aufruf (Einheiten/Waffen, die nicht mehr in der Datei stehen, werden weich geloescht).
        const { profile_id, ...roster } = extracted.roster;
        await withProfilePassword(password => bcRpc("bc_roster_import", {
          p_profile_id: cloudProfile.id,
          p_password: password,
          p_roster: roster,
          p_units: extracted.units,
          p_weapons: extracted.weapons
        }));
      }

''')
rep('''        return await supabaseRequest(`/rest/v1/army_rosters?select=id,name,profile_id&profile_id=eq.${encodeURIComponent(cloudProfile.id)}&order=name.asc`) || [];''',
    '''        return await bcRpc("bc_rosters_list", { p_profile_id: cloudProfile.id }) || [];''')
rep('''        armyUnitsByRoster.clear();
        armyWeaponsByUnit.clear();
        armyRosters = await loadArmyRosters();''', '''        armyUnitsByRoster.clear();
        armyWeaponsByUnit.clear();
        armyUnitRowsById.clear();
        armyWeaponRowsById.clear();
        armyRosterLoads.clear();
        armyRosters = await loadArmyRosters();''')

rep('''          await supabaseRequest("/rest/v1/army_rosters", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              id,
              profile_id: cloudProfile.id,
              name,
              source_file: "manual",
              catalogue_name: name,
              game_system_name: "Warhammer 40,000"
            })
          });''', '''          await withProfilePassword(password => bcRpc("bc_roster_upsert", {
            p_profile_id: cloudProfile.id,
            p_password: password,
            p_roster: {
              id,
              name,
              source_file: "manual",
              catalogue_name: name,
              game_system_name: "Warhammer 40,000"
            }
          }));''')
rep('''          showToast("Armee angelegt.");
        } catch {
          showToast("Armee konnte nicht gespeichert werden.");''', '''          showToast("Armee angelegt.");
        } catch (error) {
          showToast(cloudErrorText(error, "Armee konnte nicht gespeichert werden."));''')

rep('''          const units = await loadArmyUnits(rosterId);
          for (const unit of units) {
            await supabaseRequest(`/rest/v1/army_weapons?unit_id=eq.${encodeURIComponent(unit.id)}`, {
              method: "DELETE"
            });
          }
          await supabaseRequest(`/rest/v1/army_units?roster_id=eq.${encodeURIComponent(rosterId)}`, {
            method: "DELETE"
          });
          await supabaseRequest(`/rest/v1/army_rosters?id=eq.${encodeURIComponent(rosterId)}`, {
            method: "DELETE"
          });''', '''          await withProfilePassword(password => bcRpc("bc_roster_delete", { p_profile_id: cloudProfile.id, p_password: password, p_roster_id: rosterId }));''')
rep('''          showToast("Armee gelöscht.");
        } catch {
          showToast("Armee konnte nicht gelöscht werden.");''', '''          showToast("Armee gelöscht.");
        } catch (error) {
          showToast(cloudErrorText(error, "Armee konnte nicht gelöscht werden."));''')
rep('''          showToast("Einheit gespeichert.");
        } catch {
          showToast("Einheit konnte nicht gespeichert werden.");''', '''          showToast("Einheit gespeichert.");
        } catch (error) {
          showToast(cloudErrorText(error, "Einheit konnte nicht gespeichert werden."));''')

rep_block('''      async function saveArmyEditorUnitPayload(existingId, nextUnitId, payload, fallbackPayload) {''', '''      async function syncAttachedUnitLink(rosterId, unitId, attachedUnitId) {''', r'''      async function saveArmyEditorUnitPayload(existingId, nextUnitId, payload) {
        // Wie frueher PATCH: bestehende Werte behalten, nur die bearbeiteten Felder ersetzen (RPC speichert die ganze Zeile).
        const createRawSelection = payload.raw_selection || { manual: true, createdAt: new Date().toISOString() };
        const unit = existingId
          ? { ...(armyUnitRowsById.get(existingId) || {}), ...payload, id: existingId }
          : { id: nextUnitId, ...payload, source_file: "manual", raw_selection: createRawSelection };
        await saveArmyUnitRow(unit);
      }

      async function saveArmyUnitRow(unit) {
        await withProfilePassword(password => bcRpc("bc_unit_upsert", { p_profile_id: cloudProfile.id, p_password: password, p_unit: unit }));
        armyUnitRowsById.set(unit.id, { ...(armyUnitRowsById.get(unit.id) || {}), ...unit });
      }

''')
rep('''        const rawSelection = {
          ...(unit.raw_selection && typeof unit.raw_selection === "object" ? unit.raw_selection : {}),
          __battle_cal_editor_overrides: {
            ...(unit.raw_selection?.__battle_cal_editor_overrides || {}),''', '''        // aktuelle gespeicherte Zeile als Basis (nicht die evtl. veraltete Kopie aus dem Auswahl-Zwischenspeicher)
        const base = armyUnitRowsById.get(unit.id) || unit;
        const rawSelection = {
          ...(base.raw_selection && typeof base.raw_selection === "object" ? base.raw_selection : {}),
          __battle_cal_editor_overrides: {
            ...(base.raw_selection?.__battle_cal_editor_overrides || {}),''')
rep('''        await supabaseRequest(`/rest/v1/army_units?id=eq.${encodeURIComponent(unit.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ raw_selection: rawSelection, updated_at: new Date().toISOString() })
        });''', '''        await saveArmyUnitRow({ ...base, raw_selection: rawSelection });''')
rep('''          await supabaseRequest(`/rest/v1/army_units?id=eq.${encodeURIComponent(unitId)}`, {
            method: "DELETE"
          });''', '''          await withProfilePassword(password => bcRpc("bc_unit_delete", { p_profile_id: cloudProfile.id, p_password: password, p_unit_id: unitId }));''')
rep('''          showToast("Einheit gelöscht.");
        } catch {
          showToast("Einheit konnte nicht gelöscht werden.");''', '''          showToast("Einheit gelöscht.");
        } catch (error) {
          showToast(cloudErrorText(error, "Einheit konnte nicht gelöscht werden."));''')
rep('''          showToast("Waffe gespeichert.");
        } catch {
          showToast("Waffe konnte nicht gespeichert werden.");''', '''          showToast("Waffe gespeichert.");
        } catch (error) {
          showToast(cloudErrorText(error, "Waffe konnte nicht gespeichert werden."));''')
rep_block('''      async function saveArmyEditorWeaponPayload(existingId, nextWeaponId, payload, fallbackPayload) {''', '''      async function deleteArmyEditorWeapon() {''', r'''      async function saveArmyEditorWeaponPayload(existingId, nextWeaponId, payload) {
        const weapon = existingId
          ? { ...(armyWeaponRowsById.get(existingId) || {}), ...payload, id: existingId }
          : { id: nextWeaponId, ...payload };
        await withProfilePassword(password => bcRpc("bc_weapon_upsert", { p_profile_id: cloudProfile.id, p_password: password, p_weapon: weapon }));
        // Waffen der Armee beim naechsten Zugriff neu laden
        armyRosterLoads.delete(payload.roster_id);
      }

''')
rep('''          await supabaseRequest(`/rest/v1/army_weapons?id=eq.${encodeURIComponent(weaponId)}`, {
            method: "DELETE"
          });
          armyWeaponsByUnit.delete(unitId);''', '''          await withProfilePassword(password => bcRpc("bc_weapon_delete", { p_profile_id: cloudProfile.id, p_password: password, p_weapon_id: weaponId }));
          armyRosterLoads.delete(ids.armyEditorRosterSelect.value);
          armyWeaponsByUnit.delete(unitId);''')
rep('''          showToast("Waffe gelöscht.");
        } catch {
          showToast("Waffe konnte nicht gelöscht werden.");''', '''          showToast("Waffe gelöscht.");
        } catch (error) {
          showToast(cloudErrorText(error, "Waffe konnte nicht gelöscht werden."));''')

# Laden: eine Armee = EIN Aufruf (bc_roster_get mit Rohdaten), Einheiten und Waffen daraus zwischenspeichern.
rep_block('''      async function loadArmyUnits(rosterId) {''', '''      function normalizeArmyUnitInvulnerableSave(unit) {''', r'''      async function loadRosterBundle(rosterId, force = false) {
        if (!force && armyRosterLoads.has(rosterId)) return armyRosterLoads.get(rosterId);
        const load = bcRpc("bc_roster_get", { p_roster_id: rosterId, p_include_raw: true }).then(bundle => {
          const units = Array.isArray(bundle?.units) ? bundle.units : [];
          const weapons = Array.isArray(bundle?.weapons) ? bundle.weapons : [];
          units.forEach(unit => armyUnitRowsById.set(unit.id, unit));
          weapons.forEach(weapon => armyWeaponRowsById.set(weapon.id, weapon));
          return { units, weapons };
        });
        armyRosterLoads.set(rosterId, load);
        try {
          return await load;
        } catch (error) {
          armyRosterLoads.delete(rosterId);
          throw error;
        }
      }

      async function loadArmyUnits(rosterId) {
        if (!rosterId) return [];
        if (!getCurrentProfileRosters().some(roster => roster.id === rosterId)) return [];
        if (armyUnitsByRoster.has(rosterId)) return armyUnitsByRoster.get(rosterId);
        const bundle = await loadRosterBundle(rosterId);
        const units = bundle.units.map(normalizeArmyUnitInvulnerableSave);
        armyUnitsByRoster.set(rosterId, units);
        return units;
      }

''')
rep_block('''      async function loadArmyWeapons(unitId) {''', '''      async function loadBattleUnitWeapons(unit) {''', r'''      async function loadArmyWeapons(unitId) {
        if (!unitId) return [];
        if (armyWeaponsByUnit.has(unitId)) return armyWeaponsByUnit.get(unitId);
        const rosterId = armyUnitRowsById.get(unitId)?.roster_id;
        if (!rosterId) return [];
        const bundle = await loadRosterBundle(rosterId);
        const weapons = bundle.weapons.filter(weapon => weapon.unit_id === unitId).map(normalizeArmyWeaponRole);
        armyWeaponsByUnit.set(unitId, weapons);
        return weapons;
      }

''')
# Nach Einheit speichern/loeschen: Armee neu laden (refreshArmyData leert alle Zwischenspeicher, s. o.)

# Aufrufer der vereinfachten Speicherfunktionen (Fallback-Payload entfaellt, da alle Spalten vorhanden sind)
rep('''          await saveArmyEditorUnitPayload(existingId, nextUnitId, editablePayload, stripInvulnerableSave(editablePayload));''',
    '''          await saveArmyEditorUnitPayload(existingId, nextUnitId, editablePayload);''')
rep('''          await saveArmyEditorWeaponPayload(existingId, nextWeaponId, payload, basePayload);''',
    '''          await saveArmyEditorWeaponPayload(existingId, nextWeaponId, payload);''')

# ---------- lokaler Speicher: nie ein Passwort ablegen ----------
rep('''          const raw = localStorage.getItem(CLOUD_PROFILE_KEY);
          return raw ? JSON.parse(raw) : null;''', '''          const raw = localStorage.getItem(CLOUD_PROFILE_KEY);
          return raw ? publicProfile(JSON.parse(raw)) : null;''')
rep('''          if (cloudProfile) localStorage.setItem(CLOUD_PROFILE_KEY, JSON.stringify(cloudProfile));''',
    '''          if (cloudProfile) localStorage.setItem(CLOUD_PROFILE_KEY, JSON.stringify(publicProfile(cloudProfile)));''')

# ---------- Historie importieren + Umzug ----------
rep('''          const text = await readFileAsText(file);
          const parsed = JSON.parse(text);
          const importedEntries = normalizeImportedHistory(parsed);

          if (!importedEntries.length) {''', '''          const text = await readFileAsText(file);
          const parsed = JSON.parse(text);
          if (parsed?.source === UMZUG_FORMAT) {
            await applyUmzugPayload(parsed, { confirm: true });
            return;
          }
          const importedEntries = normalizeImportedHistory(parsed);

          if (!importedEntries.length) {''')

rep('''      function readFileAsText(file) {''', r'''      // ---------- Umzug von battle-cal.netlify.app (lokale Historie + Armeevergleiche) ----------
      const UMZUG_FORMAT = "battle-cal-umzug";

      function sanitizeCompareHtml(html) {
        const doc = new DOMParser().parseFromString(`<div>${String(html || "")}</div>`, "text/html");
        doc.querySelectorAll("script,iframe,object,embed,link,meta,style,base,form").forEach(node => node.remove());
        doc.querySelectorAll("*").forEach(node => {
          Array.from(node.attributes).forEach(attribute => {
            const name = attribute.name.toLowerCase();
            const value = String(attribute.value || "").trim().toLowerCase();
            if (name.startsWith("on") || ((name === "href" || name === "src" || name === "xlink:href") && value.startsWith("javascript:"))) {
              node.removeAttribute(attribute.name);
            }
          });
        });
        return doc.body.firstElementChild ? doc.body.firstElementChild.innerHTML : "";
      }

      function normalizeImportedCompareEntries(parsed) {
        const raw = Array.isArray(parsed?.armyCompareEntries) ? parsed.armyCompareEntries : [];
        return raw
          .filter(entry => entry && typeof entry === "object" && entry.id && entry.html)
          .map(entry => ({
            ...entry,
            id: String(entry.id).replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 120) || createId(),
            title: String(entry.title || ""),
            summary: String(entry.summary || ""),
            searchText: String(entry.searchText || ""),
            createdAt: String(entry.createdAt || new Date().toISOString()),
            html: sanitizeCompareHtml(entry.html)
          }));
      }

      async function applyUmzugPayload(payload, options = {}) {
        const entries = normalizeImportedHistory(payload);
        const compareEntries = normalizeImportedCompareEntries(payload);
        const knownIds = new Set(historyEntries.map(entry => entry.id));
        const newEntries = entries.filter(entry => !knownIds.has(entry.id));
        const knownCompare = new Set(armyCompareEntries.map(entry => entry.id));
        const newCompare = compareEntries.filter(entry => !knownCompare.has(entry.id));
        if (!newEntries.length && !newCompare.length) {
          showToast("Umzug: keine neuen Einträge gefunden.");
          return { history: 0, compare: 0 };
        }
        const target = cloudProfile ? `Cloud-Profil "${cloudProfile.name}"` : "diesen Browser (Nur lokal)";
        if (options.confirm !== false && !window.confirm(`${newEntries.length} Historien-Einträge und ${newCompare.length} Armeevergleiche von battle-cal.netlify.app in ${target} übernehmen?`)) {
          return { history: 0, compare: 0 };
        }
        historyEntries = [...historyEntries, ...newEntries]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, HISTORY_LIMIT);
        armyCompareEntries = [...armyCompareEntries, ...newCompare]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, HISTORY_LIMIT);
        saveHistory();
        saveArmyCompareHistory();
        const pushed = historyEntries.filter(entry => newEntries.some(item => item.id === entry.id));
        if (cloudProfile && pushed.length) await pushLocalHistoryToCloud(pushed);
        renderHistory();
        renderArmyCompareHistory();
        showToast(`Umzug: ${newEntries.length} Historien-Einträge, ${newCompare.length} Armeevergleiche übernommen.`);
        return { history: newEntries.length, compare: newCompare.length };
      }

      function umzugOriginAllowed(origin) {
        if (UMZUG_SOURCE_ORIGINS.includes(origin)) return true;
        // Nur fuer lokale Tests: lokale Herkunft, wenn diese Seite selbst lokal laeuft.
        const local = value => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(value);
        return local(window.location.origin) && local(origin);
      }

      function initUmzugReceiver() {
        const params = new URLSearchParams(window.location.search || "");
        if (params.get("umzug") !== "1" || !window.opener) return;
        let received = false;
        window.addEventListener("message", async event => {
          if (received || !umzugOriginAllowed(event.origin)) return;
          const data = event.data;
          if (!data || data.type !== "bc-umzug-data" || data.payload?.source !== UMZUG_FORMAT) return;
          received = true;
          const result = await applyUmzugPayload(data.payload, { confirm: true });
          try { event.source?.postMessage({ type: "bc-umzug-done", result }, event.origin); } catch {}
        });
        const targets = [...UMZUG_SOURCE_ORIGINS];
        const opener = window.opener;
        const announce = () => {
          if (received) return;
          for (const origin of targets) {
            try { opener.postMessage({ type: "bc-umzug-ready" }, origin); } catch {}
          }
          // lokale Tests: Absender-Origin aus ?from= (nur lokal erlaubt)
          const from = params.get("from") || "";
          if (from && umzugOriginAllowed(from) && !targets.includes(from)) {
            try { opener.postMessage({ type: "bc-umzug-ready" }, from); } catch {}
          }
        };
        announce();
        const timer = setInterval(() => { if (received) clearInterval(timer); else announce(); }, 1000);
        setTimeout(() => clearInterval(timer), 30000);
        showToast("Umzug: warte auf Daten von battle-cal.netlify.app …");
      }

      function readFileAsText(file) {''')

rep('''      initCloud();
      initArmyPicker();
''', '''      initCloud();
      initArmyPicker();
      initUmzugReceiver();
''')

# ---------- Restliche Fehlermeldungen (alte Supabase-Hinweise) ----------
rep('''        if (message.includes("profile_id")) return "In Supabase fehlt noch die Profil-Zuordnung. Bitte das aktuelle supabase_army_schema.sql ausführen.";
        if (message.includes("invulnerable_save")) return "In Supabase fehlt noch die Rettungswurf-Spalte. Bitte das aktuelle supabase_army_schema.sql ausführen.";
        if (message.includes("weapon_role")) return "In Supabase fehlt noch die Waffenrolle. Der Import versucht es ohne diese Spalte; bitte danach das aktuelle supabase_army_schema.sql ausführen.";
        if (message.includes("duplicate key")) return "Diese Armeeliste ist bereits teilweise vorhanden. Bitte Import erneut versuchen.";''',
    '''        if (error?.kind === "cancelled") return "Abgebrochen.";
        if (error?.kind === "forbidden") return "Passwort ist falsch oder die Armee gehört zu einem anderen Profil.";
        if (error?.kind === "invalid" && error?.message) return error.message;''')

if "supabaseRequest" in s: sys.exit("supabaseRequest ist noch vorhanden")
if re.search(r"rgvpxnmbuyxqplsfonzm|sb_publishable_", s): sys.exit("altes Projekt/Key noch vorhanden")
if "storedPassword" in s or "delete_password" in s: sys.exit("alte Passwortpruefung im Client noch vorhanden")
open(dst, "w", encoding="utf-8").write(s)
print("ok", len(s))
