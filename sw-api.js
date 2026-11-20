/* Switchwatt Portal – kleiner Client für Supabase (Auth, Datenbank, Dateien) ohne externe Bibliotheken */
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
      'Password should be at least 6 characters.': 'Das Passwort muss mindestens 8 Zeichen haben.'
    };
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
  SW.ART = { vertrag: 'Vertrag', abrechnung: 'Abrechnung', kuendigung_entwurf: 'Kündigung (Entwurf von Switchwatt)', kuendigung_unterschrieben: 'Kündigung (unterschrieben)', sonstiges: 'Sonstiges', gutschrift_dv: 'Gutschrift Direktvermarkter', gutschrift_nb: 'Abrechnung Netzbetreiber', monitoring: 'Monitoring-Auszug' };
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
      '<p>Bitte bestätigen Sie uns den Eingang dieser Kündigung und das genaue Vertragsende schriftlich.</p>' +
      '<p>Mit freundlichen Grüßen</p><br><br><br>' +
      '<p>_______________________________<br>Ort, Datum, Unterschrift, Name in Druckbuchstaben<br>' + E(a.betreiber || '') + '</p>';
    var old = document.getElementById('sw-print'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'sw-print';
    d.innerHTML = '<div class="sw-print-bar"><span>Bitte prüfen und gelb markierte Felder ergänzen. Dann drucken, unterschreiben und im Portal hochladen. Unterschreiben müssen die vertretungsberechtigten Personen, bei einer GbR in der Regel alle Gesellschafter. Die Kündigung ist Ihre Erklärung, wir bereiten sie nur vor.</span><span class="sw-row"><button class="sw-btn small" data-p="print">Drucken / als PDF speichern</button><button class="sw-btn ghost small" data-p="close">Schließen</button></span></div><div class="sw-letter">' + L + '</div>';
    document.body.appendChild(d);
    d.querySelector('[data-p=print]').onclick = function () { window.print(); };
    d.querySelector('[data-p=close]').onclick = function () { d.remove(); };
    return L;
  };

  SW.VOLLMACHT_VERSION = 'test-2026-11-19';
  SW.VOLLMACHT_HTML =
    '<p class="sw-muted" style="margin-top:0">Testfassung für die Pilotphase. Sie wird vor dem offiziellen Start anwaltlich geprüft.</p>' +
    '<p>Hiermit bevollmächtige ich die WordAtech UG (haftungsbeschränkt), Kaiser-Friedrich-Promenade 79, 61348 Bad Homburg v. d. Höhe, handelnd unter ihrer Marke Switchwatt, für die Anlagen, die ich in meinem Switchwatt-Konto anlege,</p>' +
    '<ol><li>in meinem Namen bei Direktvermarktern Angebote für die Direktvermarktung anzufragen und dafür die nötigen Anlagen- und Vertragsdaten weiterzugeben,</li>' +
    '<li>beim zuständigen Netz- und Messstellenbetreiber die Einspeisedaten (Lastgang) der letzten 36 Monate und die Stammdaten der Anlagen anzufordern,</li>' +
    '<li>die Angebote auszuwerten und mir eine Empfehlung zu geben.</li></ol>' +
    '<p>Gebe ich ein Angebot im Kundenkonto frei, ist die WordAtech UG außerdem bevollmächtigt, (4) meinen bisherigen Direktvermarktungsvertrag fristgerecht zu kündigen, soweit dafür nicht meine eigene Unterschrift nötig ist, (5) den Vertrag mit dem gewählten Direktvermarkter vorzubereiten und in meinem Namen abzuschließen und (6) die für den Wechsel nötigen Meldungen und die technische Anbindung zu veranlassen. <strong>Ohne Freigabe</strong> darf die WordAtech UG in meinem Namen keine Verträge abschließen oder kündigen.</p>' +
    '<p>Die Vollmacht gilt bis auf Widerruf und kann jederzeit per E-Mail an angebote@switchwatt.de widerrufen werden. Meine Daten werden dafür nach der <a href="datenschutz.html" target="_blank">Datenschutzerklärung</a> verarbeitet.</p>';

  window.SW = SW;
})();
