/* SwitchWatt Portal – kleiner Client für Supabase (Auth, Datenbank, Dateien) ohne externe Bibliotheken */
(function () {
  var URL_ = 'https://fyseraoxefnwsayvqzps.supabase.co';
  var KEY = 'sb_publishable_IRGqBkjaUa3_YnZ2HGDdSg_HU6m5ltO';
  var STORE = 'sw-session';

  function load() { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; } }
  function save(s) { try { if (s) localStorage.setItem(STORE, JSON.stringify(s)); else localStorage.removeItem(STORE); } catch (e) {} }
  var session = load();

  function setSession(d) {
    if (!d || !d.access_token) { session = null; save(null); return null; }
    session = { access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: d.expires_at || (Math.floor(Date.now() / 1000) + (d.expires_in || 3600)), user: d.user };
    save(session); return session;
  }

  function errText(j, status) {
    var m = (j && (j.msg || j.message || j.error_description || j.error)) || ('Fehler ' + status);
    var map = {
      'Invalid login credentials': 'E-Mail oder Passwort stimmt nicht.',
      'User already registered': 'Für diese E-Mail gibt es schon ein Konto. Bitte melden Sie sich an.',
      'Email not confirmed': 'Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse.',
      'Password should be at least 6 characters.': 'Das Passwort ist zu kurz.'
    };
    if (/password/i.test(m) && /(at least|contain|weak|characters)/i.test(m)) return 'Das Passwort ist zu schwach: mindestens 10 Zeichen mit Groß- und Kleinbuchstaben, Ziffer und Sonderzeichen.';
    return map[m] || m;
  }

  async function authCall(path, body, method) {
    var r = await fetch(URL_ + '/auth/v1/' + path, {
      method: method || 'POST',
      headers: Object.assign({ apikey: KEY, 'Content-Type': 'application/json' },
        session && method === 'PUT' ? { Authorization: 'Bearer ' + session.access_token } : {}),
      body: JSON.stringify(body || {})
    });
    var j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(errText(j, r.status));
    return j;
  }

  async function token() {
    if (!session) return null;
    if (session.expires_at - 60 < Date.now() / 1000) {
      try { setSession(await authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token })); }
      catch (e) { setSession(null); return null; }
    }
    return session.access_token;
  }

  async function headers(extra) {
    var t = await token();
    var h = { apikey: KEY };
    if (t) h.Authorization = 'Bearer ' + t;
    return Object.assign(h, extra || {});
  }

  var SW = {
    get user() { return session && session.user; },
    async signUp(email, password, meta) {
      var d = await authCall('signup', { email: email, password: password, data: meta || {} });
      if (d && d.access_token) setSession(d);
      return d;
    },
    async signIn(email, password) { return setSession(await authCall('token?grant_type=password', { email: email, password: password })); },
    async recover(email) { var r = await fetch(URL_ + '/functions/v1/passwort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) }); if (!r.ok) throw new Error('Das hat leider nicht geklappt. Bitte später noch einmal versuchen.'); return true; },
    async setPassword(pw) { await token(); return authCall('user', { password: pw }, 'PUT'); },
    async signOut() { try { await fetch(URL_ + '/auth/v1/logout', { method: 'POST', headers: await headers() }); } catch (e) {} setSession(null); },
    fromHash() {
      if (!location.hash || location.hash.indexOf('access_token=') < 0) return null;
      var p = new URLSearchParams(location.hash.slice(1));
      var s = setSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'),
        expires_in: +p.get('expires_in') || 3600, user: null });
      history.replaceState(null, '', location.pathname);
      return p.get('type');
    },
    async me() {
      var r = await fetch(URL_ + '/auth/v1/user', { headers: await headers() });
      if (!r.ok) return null;
      var u = await r.json(); if (session) { session.user = u; save(session); } return u;
    },
    async rest(path, opt) {
      opt = opt || {};
      var h = await headers({ 'Content-Type': 'application/json' });
      if (opt.prefer) h.Prefer = opt.prefer;
      var r = await fetch(URL_ + '/rest/v1/' + path, { method: opt.method || 'GET', headers: h,
        body: opt.body ? JSON.stringify(opt.body) : undefined });
      var txt = await r.text(); var j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
      if (!r.ok) throw new Error(errText(j, r.status));
      return j;
    },
    async upload(path, file) {
      var ext = String(file.name || '').toLowerCase().split('.').pop();
      var typ = file.type || ({ csv: 'text/csv', txt: 'text/plain', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' })[ext] || 'application/octet-stream';
      var h = await headers({ 'Content-Type': typ, 'x-upsert': 'false' });
      var r = await fetch(URL_ + '/storage/v1/object/dokumente/' + path.split('/').map(encodeURIComponent).join('/'),
        { method: 'POST', headers: h, body: file });
      if (!r.ok) { var j = null; try { j = await r.json(); } catch (e) {} throw new Error(errText(j, r.status)); }
      return true;
    },
    async fn(name, body) {
      var r = await fetch(URL_ + '/functions/v1/' + name, { method: 'POST', headers: await headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body || {}) });
      var j = null; try { j = await r.json(); } catch (e) {}
      return j || { ok: false, error: 'Fehler ' + r.status };
    },
    async removeFile(path) {
      var r = await fetch(URL_ + '/storage/v1/object/dokumente/' + path.split('/').map(encodeURIComponent).join('/'), { method: 'DELETE', headers: await headers({}) });
      if (!r.ok) { var j = null; try { j = await r.json(); } catch (e) {} throw new Error(errText(j, r.status)); }
      return true;
    },
    async fileUrl(path) {
      var r = await fetch(URL_ + '/storage/v1/object/sign/dokumente/' + path.split('/').map(encodeURIComponent).join('/'),
        { method: 'POST', headers: await headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: 300 }) });
      var j = await r.json(); if (!r.ok) throw new Error(errText(j, r.status));
      return URL_ + '/storage/v1' + j.signedURL;
    }
  };

  /* kleine Helfer für die Seiten */
  SW.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  SW.date = function (d) { if (!d) return '–'; var x = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d); return isNaN(x) ? SW.esc(d) : x.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }); };
  SW.dateTime = function (d) { if (!d) return '–'; return new Date(d).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }); };
  SW.num = function (n, digits) { if (n == null || n === '') return '–'; return Number(n).toLocaleString('de-DE', { maximumFractionDigits: digits == null ? 0 : digits, minimumFractionDigits: digits || 0 }); };
  SW.STATUS = {
    neu: ['Eingereicht', '#8FA6FF'], in_pruefung: ['Wir prüfen', '#F5B70A'], angebote: ['Angebote liegen vor', '#22C55E'],
    freigegeben: ['Freigegeben', '#22C55E'], kuendigung: ['Kündigung läuft', '#F5B70A'], gewechselt: ['Gewechselt', '#22C55E'],
    abgebrochen: ['Abgebrochen', '#71717A']
  };
  SW.badge = function (s) { var x = SW.STATUS[s] || [s, '#A1A1AA']; return '<span class="sw-badge" style="--c:' + x[1] + '">' + SW.esc(x[0]) + '</span>'; };
  SW.ART = { vertrag: 'Vertrag', abrechnung: 'Abrechnung', kuendigung_entwurf: 'Kündigung (Entwurf von SwitchWatt)', kuendigung_unterschrieben: 'Kündigung (unterschrieben)', sonstiges: 'Sonstiges', gutschrift_dv: 'Gutschrift Direktvermarkter', gutschrift_nb: 'Abrechnung Netzbetreiber', monitoring: 'Monitoring-Auszug' };
  SW.daysUntil = function (d) { if (!d) return null; var t = new Date(); var a = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()); var p = String(d).slice(0, 10).split('-'); return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - a) / 86400000); };
  SW.arr = function (x) { return x == null ? [] : Array.isArray(x) ? x : [x]; };
  SW.safeName = function (n) { return String(n).normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-80); };

  /* Kündigungsschreiben: erscheint im Portal, druckbar als PDF */
  SW.kuendigung = function (a, absender) {
    var heute = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    var E = SW.esc, leer = function (t) { return '<span style="background:#FFF3C4">[' + t + ']</span>'; };
    var ein = ((a.register && a.register.einheiten) || []).filter(function (u) { return u && u.mastr; });
    var zeile = function (k, v) { return '<tr><td style="padding:1px 14px 1px 0;vertical-align:top;white-space:nowrap">' + k + '</td><td style="padding:1px 0">' + v + '</td></tr>'; };
    var L = '<div class="k">' + E(a.betreiber || absender || '') + (a.betreiber ? '' : leer('Betreiber')) + '<br>' + (a.betreiber_anschrift ? E(a.betreiber_anschrift) : leer('Anschrift Betreiber')) + '</div><br>' +
      '<div class="k">' + (a.direktvermarkter ? E(a.direktvermarkter) : leer('Direktvermarkter')) + '<br>' + (a.dv_anschrift ? E(a.dv_anschrift) : leer('Anschrift Direktvermarkter')) + '</div>' +
      '<p style="text-align:right">' + heute + '</p>' +
      '<h1>Kündigung des Direktvermarktungsvertrags</h1>' +
      '<table style="border-collapse:collapse;margin:0 0 14px">' +
      zeile('Vertragspartner (Anlagenbetreiber):', a.betreiber ? E(a.betreiber) : leer('Betreiber')) +
      zeile('Vertrags-/Kundennummer:', a.dv_vertragsnr ? E(a.dv_vertragsnr) : leer('bitte aus dem Vertrag eintragen')) +
      zeile('Anlage:', E(a.name || '') + (a.kwp ? ', ' + SW.num(a.kwp, 2) + ' kWp' : '')) +
      zeile('Standort:', a.standort ? E(a.standort) : leer('Standort')) +
      zeile('MaStR-Nummer' + (ein.length > 1 ? 'n' : '') + ':', ein.length ? ein.map(function (u) { return E(u.mastr) + (ein.length > 1 && u.name ? ' (' + E(u.name) + ')' : ''); }).join('<br>') : (a.mastr ? E(a.mastr) : leer('MaStR-Nummer'))) +
      zeile('Marktlokation (MaLo):', a.malo ? E(a.malo) : leer('Marktlokations-ID')) +
      zeile('Netzbetreiber:', a.netzbetreiber ? E(a.netzbetreiber) : leer('Netzbetreiber')) +
      (ein.length === 1 && ein[0].inbetriebnahme ? zeile('Inbetriebnahme:', SW.date(ein[0].inbetriebnahme)) : '') +
      '</table>' +
      '<p>Sehr geehrte Damen und Herren,</p>' +
      '<p>hiermit kündigen wir den Direktvermarktungsvertrag für die oben genannte Anlage ordentlich und fristgerecht ' +
      (a.vertragsende ? 'zum ' + SW.date(a.vertragsende) + ', hilfsweise zum nächstmöglichen Termin.' : 'zum nächstmöglichen Termin.') + '</p>' +
      '<p>Bitte bestätigen Sie uns den Eingang dieser Kündigung und das genaue Vertragsende schriftlich. Bitte senden Sie die Bestätigung in Kopie an unseren Wechseldienstleister SwitchWatt, angebote@switchwatt.de.</p>' +
      '<p>Mit freundlichen Grüßen</p><br><br><br>' +
      '<p>_______________________________<br>Ort, Datum, Unterschrift, Name in Druckbuchstaben<br>' + E(a.betreiber || '') + '</p>';
    var old = document.getElementById('sw-print'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'sw-print';
    d.innerHTML = '<div class="sw-print-bar"><span>Bitte prüfen und gelb markierte Felder ergänzen. Dann drucken, unterschreiben und im Portal hochladen. Unterschreiben müssen die vertretungsberechtigten Personen: bei einer GmbH Geschäftsführer oder Prokuristen in vertretungsberechtigter Zahl, bei einer GbR in der Regel alle Gesellschafter. Die Kündigung ist Ihre Erklärung, wir bereiten sie nur vor.</span><span class="sw-row"><button class="sw-btn small" data-p="print">Drucken / als PDF speichern</button><button class="sw-btn ghost small" data-p="close">Schließen</button></span></div><div class="sw-letter">' + L + '</div>';
    document.body.appendChild(d);
    d.querySelector('[data-p=print]').onclick = function () { window.print(); };
    d.querySelector('[data-p=close]').onclick = function () { d.remove(); };
    return L;
  };

  SW.VOLLMACHT_VERSION = '2026-11-23';
  SW.AGB_VERSION = '23.11.2026';
  SW.vmFassung = function (v) {
    var m = /^(test-)?(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    if (!m) return 'Fassung ' + (v || '');
    return (m[1] ? 'Pilotfassung' : 'Fassung') + ' vom ' + m[4] + '.' + m[3] + '.' + m[2];
  };
  SW.VOLLMACHT_HTML =
    '<p>Der Betreiber der ausgewählten Anlagen, vertreten durch die unterzeichnende Person (zusammen „ich“), bevollmächtigt die WordAtech UG (haftungsbeschränkt), Kaiser-Friedrich-Promenade 79, 61348 Bad Homburg v. d. Höhe, handelnd unter der Marke SwitchWatt, für die Anlagen, die ich bei Erteilung dieser Vollmacht in meinem SwitchWatt-Konto auswähle,</p>' +
    '<ol><li>in meinem Namen bei Direktvermarktern Angebote für die Direktvermarktung anzufragen und dafür die nötigen Anlagen- und Vertragsdaten weiterzugeben,</li>' +
    '<li>beim zuständigen Netz- und Messstellenbetreiber die Stammdaten der Anlagen und die Einspeisedaten (Lastgang) für bis zu 36 Monate anzufordern,</li>' +
    '<li>die Angebote auszuwerten und mir einen Angebotsspiegel zur Verfügung zu stellen.</li></ol>' +
    '<p>Gebe ich ein Angebot im Kundenkonto frei, ist die WordAtech UG außerdem bevollmächtigt,</p>' +
    '<ol start="4"><li>die Kündigung meines bisherigen Direktvermarktungsvertrags und den Vertrag mit dem gewählten Direktvermarkter vorzubereiten und die von mir unterschriebenen Erklärungen an den jeweiligen Vertragspartner zu übermitteln,</li>' +
    '<li>die für den Wechsel nötigen Meldungen beim Netzbetreiber anzustoßen und Termine und technische Daten für die Anbindung abzustimmen; dazu darf sie die nötigen Anlagendaten an den von mir beauftragten Anbindungsdienstleister (z. B. SolarBridge GmbH) weitergeben.</li></ol>' +
    '<p>Kündigungen und Vertragserklärungen gebe ich selbst ab. Die WordAtech UG ist nicht berechtigt, in meinem Namen Verträge abzuschließen oder zu kündigen.</p>' +
    '<p>Die unterzeichnende Person versichert, allein vertretungsberechtigt zu sein oder mit Zustimmung aller Vertretungsberechtigten zu handeln (bei einer GbR ohne abweichende Regelung alle Gesellschafter).</p>' +
    '<p>Die Vollmacht gilt bis auf Widerruf. Ich kann sie jederzeit im Kundenkonto oder per E-Mail an angebote@switchwatt.de widerrufen. Es gelten die <a href="agb.html" target="_blank">Allgemeinen Geschäftsbedingungen</a> von SwitchWatt. Meine Daten werden nach der <a href="datenschutz.html" target="_blank">Datenschutzerklärung</a> verarbeitet.</p>';

  // Auge in jedem Passwortfeld: Passwort anzeigen oder verbergen.
  var AUGE='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var AUGE_ZU='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a10.6 10.6 0 0 0 5.4-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  function augen(root) {
    (root || document).querySelectorAll('input[type="password"]:not([data-auge])').forEach(function (inp) {
      inp.setAttribute('data-auge', '1');
      var w = document.createElement('span'); w.className = 'sw-pw';
      inp.parentNode.insertBefore(w, inp); w.appendChild(inp);
      var b = document.createElement('button'); b.type = 'button'; b.className = 'sw-pw-btn'; b.innerHTML = AUGE; b.setAttribute('aria-label', 'Passwort anzeigen');
      b.onclick = function () { var zeigen = inp.type === 'password'; inp.type = zeigen ? 'text' : 'password'; b.innerHTML = zeigen ? AUGE_ZU : AUGE; b.setAttribute('aria-label', zeigen ? 'Passwort verbergen' : 'Passwort anzeigen'); inp.focus(); };
      w.appendChild(b);
    });
  }
  if (window.MutationObserver) new MutationObserver(function () { augen(); }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', function () { augen(); });

  // Drag and Drop: Dateien auf ein Upload-Feld (oder dessen Label/Bereich) ziehen
  function dropZiel(el) {
    if (!el || !el.closest) return null;
    var i = el.closest('input[type=file]'); if (i) return i;
    var l = el.closest('label[for]');
    if (l) { var x = document.getElementById(l.getAttribute('for')); if (x && x.type === 'file') return x; }
    for (var n = el, k = 0; n && n !== document.body && k < 4; n = n.parentElement, k++) {
      var fs = n.querySelectorAll ? n.querySelectorAll('input[type=file]') : [];
      if (fs.length === 1) return fs[0];
      if (fs.length > 1) return null;
    }
    return null;
  }
  function zone(inp) { if (!inp) return null; var l = inp.id && document.querySelector('label.sw-drop[for="' + inp.id + '"]'); return l || inp; }
  var markiert = null;
  function markiere(z) { if (markiert === z) return; if (markiert) markiert.classList.remove('sw-dragover'); markiert = z; if (z) z.classList.add('sw-dragover'); }
  function hatDateien(e) { var t = e.dataTransfer && e.dataTransfer.types; return t && Array.prototype.indexOf.call(t, 'Files') >= 0; }
  document.addEventListener('dragover', function (e) {
    if (!hatDateien(e)) return;
    e.preventDefault();
    var inp = dropZiel(e.target);
    e.dataTransfer.dropEffect = inp && !inp.disabled ? 'copy' : 'none';
    markiere(inp && !inp.disabled ? zone(inp) : null);
  });
  document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) markiere(null); });
  document.addEventListener('drop', function (e) {
    if (!hatDateien(e)) return;
    e.preventDefault(); markiere(null);
    var inp = dropZiel(e.target); if (!inp || inp.disabled) return;
    var neu = Array.prototype.slice.call(e.dataTransfer.files || []);
    var acc = String(inp.accept || '').split(',').map(function (a) { return a.trim().toLowerCase(); }).filter(Boolean);
    if (acc.length) neu = neu.filter(function (f) { var n = f.name.toLowerCase(), t = (f.type || '').toLowerCase(); return acc.some(function (a) { return a[0] === '.' ? n.slice(-a.length) === a : a.slice(-2) === '/*' ? t.indexOf(a.slice(0, -1)) === 0 : t === a; }); });
    if (!neu.length) { alert('Dieser Dateityp passt hier nicht. Bitte PDF oder Foto (JPG, PNG) verwenden.'); return; }
    var dt = new DataTransfer();
    if (inp.multiple) { Array.prototype.forEach.call(inp.files || [], function (f) { dt.items.add(f); }); neu.forEach(function (f) { dt.items.add(f); }); }
    else dt.items.add(neu[0]);
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });

  window.SW = SW;
})();
