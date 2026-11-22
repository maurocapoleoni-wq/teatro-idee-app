// Idee: raccoglie le idee dal telefono nella cartella inbox/ di un archivio GitHub privato.
// Nessun dato personale è scritto in questo codice: chiave e nome dell'archivio restano
// solo nel telefono (localStorage). Non modifica mai un file esistente: ogni idea e ogni
// osservazione è un file nuovo.
'use strict';

const $ = (id) => document.getElementById(id);
const API = 'https://api.github.com';
const leggi = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const scrivi = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* memoria piena o bloccata */ } };
const testoMemoria = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const memoria = {
  get chiave() { return testoMemoria('chiave'); },
  get archivio() { return testoMemoria('archivio') || 'teatro-wiki'; },
  get proprietario() { return testoMemoria('proprietario'); },
  get coda() { return leggi('coda', []); },
  set coda(v) { scrivi('coda', v); },
};
const collegata = () => memoria.chiave && memoria.proprietario;

// ---------- GitHub ----------
function api(percorso, opzioni = {}) {
  return fetch(API + percorso, {
    ...opzioni,
    headers: {
      Authorization: 'Bearer ' + memoria.chiave,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opzioni.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}
const repo = () => `/repos/${encodeURIComponent(memoria.proprietario)}/${encodeURIComponent(memoria.archivio)}`;
function inBase64(testo) {
  const b = new TextEncoder().encode(testo); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function daBase64(b64) {
  const s = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
}

// ---------- Note ----------
const due = (n) => String(n).padStart(2, '0');
function adesso() {
  const d = new Date();
  return {
    giorno: `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`,
    ora: `${due(d.getHours())}:${due(d.getMinutes())}`,
    compatta: `${due(d.getHours())}${due(d.getMinutes())}${due(d.getSeconds())}`,
  };
}
function titoletto(testo) {
  const s = testo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 5).join('-');
  return (s || 'idea').slice(0, 40).replace(/-+$/, '');
}
function preparaNota(testo, intestazione, prefisso = '') {
  const t = adesso();
  const righe = [];
  for (const [k, v] of Object.entries(intestazione)) if (v) righe.push(`${k}: ${v}`);
  righe.push('fonte: app', `data: ${t.giorno} ${t.ora}`, '', testo.trim(), '');
  return { nome: `${t.giorno}-${t.compatta}-${prefisso}${titoletto(testo)}.md`, contenuto: righe.join('\n') };
}
// Legge le righe "chiave: valore" in testa alla nota, fino alla prima riga vuota.
function analizza(nome, testo, cartella) {
  const righe = testo.replace(/\r/g, '').split('\n');
  const testa = {}; let i = 0;
  while (i < righe.length && /^[a-z_]+:\s/.test(righe[i])) {
    const p = righe[i].indexOf(':'); testa[righe[i].slice(0, p)] = righe[i].slice(p + 1).trim(); i++;
  }
  if (i > 0 && righe[i] === '') i++;
  const corpo = righe.slice(i).join('\n').trim();
  const m = nome.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/);
  const data = testa.data || (m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : nome.slice(0, 10));
  return { nome, cartella, opera: testa.opera || '', riferita: testa.riferita_a || '', giro: testa.giro || '', autore: testa.autore || '', bozza: testa.bozza || '', tipo: testa.tipo || '', data, corpo };
}

// Crea il file senza mai sovrascrivere: se il nome esiste già, aggiunge -2, -3…
async function creaFile(nota, cartella = 'inbox', messaggio = 'Dal telefono') {
  for (let n = 1; n <= 9; n++) {
    const nome = n === 1 ? nota.nome : nota.nome.replace(/\.md$/, `-${n}.md`);
    const r = await api(`${repo()}/contents/${cartella}/${encodeURIComponent(nome)}`, {
      method: 'PUT',
      body: JSON.stringify({ message: `${messaggio}: ${nome}`, content: inBase64(nota.contenuto) }),
    });
    if (r.status === 201) return nome;
    if (r.status === 422) continue;
    const e = new Error('http ' + r.status); e.stato = r.status; throw e;
  }
  throw new Error('troppi nomi uguali');
}

// ---------- Coda (funziona anche senza rete) ----------
let invioInCorso = false;
async function svuotaCoda(idEsito = 'esito') {
  if (invioInCorso || !collegata()) return;
  invioInCorso = true;
  let inviate = 0;
  try {
    while (memoria.coda.length) {
      const nota = memoria.coda[0];
      try { await creaFile(nota); } catch (e) {
        mostra(idEsito, (e.stato === 401 || e.stato === 403 || e.stato === 404)
          ? 'La chiave non funziona più: controllala nelle impostazioni. Il testo è salvato qui.'
          : 'Niente rete: il testo è salvato qui e parte appena torna la connessione.', e.stato ? 'errore' : 'tenue');
        break;
      }
      memoria.coda = memoria.coda.slice(1);
      inviate++;
      mostra(idEsito, 'Arrivata nell\'archivio ✓', 'ok');
    }
  } finally {
    invioInCorso = false;
    if (inviate) await caricaNote();
    disegnaTutto();
  }
}

// ---------- Archivio: elenco delle note ----------
// Le note non cambiano mai, quindi il loro contenuto si tiene in memoria per sempre (chiave: sha).
let note = leggi('note', []);
async function caricaNote() {
  if (!collegata() || !navigator.onLine) return;
  mostra('stato-lista', 'Aggiorno…', 'tenue centro');
  try {
    const r = await api(`${repo()}/git/trees/HEAD?recursive=1`);
    if (!r.ok) throw new Error('http ' + r.status);
    const albero = (await r.json()).tree.filter((f) => f.type === 'blob' && (/^inbox\/(archivio\/)?[^/]+\.md$/.test(f.path) || /^spettatore\/[^/]+--(giro|bozza)-\d+\.md$/.test(f.path) || /^spettatore\/(frequenza|stato|richieste)\/[^/]+\.md$/.test(f.path)) && !f.path.endsWith('LEGGIMI.md'));
    const cache = leggi('cache', {});
    const daScaricare = albero.filter((f) => !cache[f.sha]);
    for (let i = 0; i < daScaricare.length; i += 6) {
      await Promise.all(daScaricare.slice(i, i + 6).map(async (f) => {
        const b = await api(`${repo()}/git/blobs/${f.sha}`);
        if (b.ok) cache[f.sha] = daBase64((await b.json()).content);
      }));
    }
    const vivi = {};
    // La frequenza dello spettatore: vale il file più recente di spettatore/frequenza/.
    const freq = albero.filter((f) => f.path.startsWith('spettatore/frequenza/')).sort((a, b) => a.path.localeCompare(b.path)).pop();
    if (freq && cache[freq.sha] !== undefined) {
      vivi[freq.sha] = cache[freq.sha];
      const m = cache[freq.sha].match(/^frequenza:\s*(\S+)/m);
      if (m) scrivi('frequenza', m[1]);
    }
    // Lo stato di ogni idea (spettatore, drammaturgo, a-posto): vale il file più recente.
    const stati = {};
    albero.filter((f) => f.path.startsWith('spettatore/stato/') && cache[f.sha] !== undefined)
      .sort((a, b) => a.path.localeCompare(b.path)).forEach((f) => {
        vivi[f.sha] = cache[f.sha];
        const testo = cache[f.sha];
        const rif = (testo.match(/^riferita_a:\s*(.+)$/m) || [])[1], st = (testo.match(/^stato:\s*(\S+)/m) || [])[1];
        if (rif && st) stati[rif.trim()] = st;
      });
    scrivi('stati', stati);
    // Le richieste di «sinossi fin qui»: per ogni idea conta la data della più recente.
    const richieste = {};
    albero.filter((f) => f.path.startsWith('spettatore/richieste/') && cache[f.sha] !== undefined)
      .sort((a, b) => a.path.localeCompare(b.path)).forEach((f) => {
        vivi[f.sha] = cache[f.sha];
        const r = analizza(f.path.split('/').pop(), cache[f.sha], 'richieste');
        if (r.riferita) richieste[r.riferita] = r.data;
      });
    scrivi('richieste', richieste);
    note = albero.filter((f) => cache[f.sha] !== undefined && !/^spettatore\/(frequenza|stato|richieste)\//.test(f.path)).map((f) => {
      vivi[f.sha] = cache[f.sha];
      const nome = f.path.split('/').pop();
      return analizza(nome, cache[f.sha], f.path.startsWith('spettatore/') ? 'spettatore' : f.path.includes('/archivio/') ? 'archivio' : 'inbox');
    });
    scrivi('cache', vivi); scrivi('note', note);
    avvisaDomandeNuove();
    mostra('stato-lista', '', '');
  } catch {
    mostra('stato-lista', navigator.onLine ? 'Non riesco a leggere l\'archivio. Controlla la chiave.' : 'Senza rete: mostro l\'ultima copia.', 'tenue centro');
  }
}
// ---------- Suono quando arrivano domande nuove ----------
// Si sente solo con l'app aperta: a ogni aggiornamento confronta i giri con quelli già visti.
// Spettatore: due note che salgono. Drammaturgo: tre note più gravi.
// Se il telefono non lascia suonare prima di un tocco, il suono parte al primo tocco.
let audio = null, suonoInAttesa = null;
function sbloccaAudio() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') return audio.resume(); } catch { /* niente audio */ }
  return Promise.resolve();
}
document.addEventListener('pointerdown', () => {
  sbloccaAudio().then(() => { if (suonoInAttesa !== null) { const d = suonoInAttesa; suonoInAttesa = null; suona(d); } });
}, { passive: true });
function suona(dramm) {
  const p = sbloccaAudio(); if (!audio) return;
  if (audio.state === 'running') { suonaOra(dramm); return; }
  suonoInAttesa = dramm;
  Promise.race([p, new Promise((r) => setTimeout(r, 400))]).then(() => {
    if (audio.state === 'running' && suonoInAttesa !== null) { suonoInAttesa = null; suonaOra(dramm); }
  });
}
function suonaOra(dramm) {
  const note = dramm ? [392, 523.25, 659.25] : [659.25, 987.77];
  note.forEach((f, i) => {
    const t = audio.currentTime + i * 0.18, o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.55);
  });
  if (navigator.vibrate) navigator.vibrate(dramm ? [80, 60, 80, 60, 80] : [80, 60, 80]);
}
// Domande non ancora lette: giri (e bozze) che l'autore non ha ancora aperto.
// La prima volta contano come non lette solo le domande che aspettano ancora una risposta.
function nonLetti(nome) {
  const letti = leggi('giri-letti', []);
  return note.filter((n) => n.riferita === nome && n.cartella === 'spettatore' && !letti.includes(n.nome));
}
function segnaLetti(nome) {
  const letti = new Set(leggi('giri-letti', []));
  note.filter((n) => n.riferita === nome && n.cartella === 'spettatore').forEach((n) => letti.add(n.nome));
  scrivi('giri-letti', [...letti]);
}
let avvioSuonato = false;
function avvisaDomandeNuove() {
  const giri = note.filter((n) => n.cartella === 'spettatore');
  if (leggi('giri-letti', null) === null) {
    scrivi('giri-letti', giri.filter((g) => { const d = dialogoDi(g.riferita); return d[d.length - 1] !== g; }).map((g) => g.nome));
  }
  const visti = leggi('giri-visti', null);
  scrivi('giri-visti', giri.map((n) => n.nome));
  // All'apertura: suona se c'è almeno un'icona rossa.
  if (!avvioSuonato) {
    avvioSuonato = true;
    const rossi = giri.filter((g) => nonLetti(g.riferita).includes(g));
    if (rossi.length) { suona(rossi.some(eDrammaturgo)); return; }
  }
  if (visti === null) return;
  // Con l'app già aperta: suona per i giri arrivati dopo l'ultimo controllo.
  const nuovi = giri.filter((n) => !visti.includes(n.nome));
  if (nuovi.length) suona(nuovi.some(eDrammaturgo));
}

async function caricaOpere() {
  if (!collegata() || !navigator.onLine) return;
  try {
    const r = await api(`${repo()}/contents/wiki/opere`);
    if (!r.ok) return;
    scrivi('opere', (await r.json()).filter((f) => f.type === 'dir' && !f.name.startsWith('_')).map((f) => f.name));
    disegnaOpere();
  } catch { /* uso l'elenco salvato */ }
}

// ---------- Disegno ----------
function mostra(id, testo, classe = '') { const el = $(id); if (el) { el.textContent = testo; el.className = classe || el.className.replace(/\b(ok|errore|tenue)\b/g, '').trim(); } }
function el(tag, classe, testo) { const e = document.createElement(tag); if (classe) e.className = classe; if (testo !== undefined) e.textContent = testo; return e; }

const TINTE = ['#5b1a24', '#2e4a62', '#4a5d23', '#6b3f69', '#7a4b1e', '#1f5c57', '#7d2e2e', '#3d3a6b'];
// Nei temi chiari le copertine usano colori pastello (stesso ordine: ogni opera tiene il suo colore).
const TINTE_CHIARE = { pergamena: ['#9e2a1e', '#24407a', '#3f6b2a', '#a8771f', '#5e2d5e', '#6b4423', '#1f5c57', '#7a1f3d'],
  fluo: ['#ff2bd6', '#00e5ff', '#39ff14', '#ffe600', '#ff7a00', '#b026ff', '#ff3864', '#00ffa3'],
  carta: ['#e2c2a8', '#c5d0d8', '#cfd6b4', '#d8c5d6', '#e6cfa6', '#bfd6cf', '#e0b9ac', '#cbc6dc'] };
// Pergamena e Scuro: le idee senza opera («opera attiva») si alternano verde e blu, come le miniature.
// Scuro: sfumature verticali, dal verde all'arancio e dal rosso al blu, con i bordi più scuri.
const SENZA_OPERA = { pergamena: ['#3f6b2a', '#24407a'],
  scuro: ['linear-gradient(180deg, #0f3d22 0%, #23874a 30%, #c8621a 72%, #6a2506 100%)',
          'linear-gradient(180deg, #5e0f06 0%, #b2301a 30%, #3448a8 72%, #121c4a 100%)'] };
function tinta(opera, i = 0) {
  const alterna = SENZA_OPERA[document.documentElement.dataset.tema];
  if (!opera && alterna) { const p = alterna[i % alterna.length]; return p.startsWith('linear') ? p : `linear-gradient(135deg, ${p}, ${p}cc)`; }
  const chiare = TINTE_CHIARE[document.documentElement.dataset.tema];
  if (!opera) return chiare ? ({ carta: 'linear-gradient(135deg,#e8d9bb,#d8c49c)', fluo: 'linear-gradient(135deg,#ff2bd6,#00e5ff)' }[document.documentElement.dataset.tema] || 'linear-gradient(135deg,#7a5a36,#5a3d20)') : 'linear-gradient(135deg,#4b3f39,#7a6a60)';
  let h = 0; for (const c of opera) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  if (chiare) { const p = chiare[h % chiare.length]; return `linear-gradient(135deg, ${p}, ${p}cc)`; }
  const t = TINTE[h % TINTE.length];
  return `linear-gradient(135deg, ${t}, ${t}cc)`;
}
const nomeOpera = (o) => o ? o.replace(/-/g, ' ') : 'opera attiva';
function dataBreve(d) {
  const [g, o] = d.split(' '); const [a, m, gg] = (g || '').split('-');
  const mesi = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return gg ? `${+gg} ${mesi[+m - 1]} ${a}${o ? ' · ' + o : ''}` : d;
}

function idee() {
  // Idee = note che non sono osservazioni. Più le idee ancora in coda.
  const inCoda = memoria.coda.filter((n) => !/\nriferita_a: |^riferita_a: /.test(n.contenuto))
    .map((n) => ({ ...analizza(n.nome, n.contenuto, 'coda') }));
  return [...inCoda, ...note.filter((n) => !n.riferita)].sort((a, b) => b.nome.localeCompare(a.nome));
}
// Versioni del testo: quando l'autore modifica un'idea nasce un file nuovo (tipo: versione);
// l'originale resta intatto e vale il testo della versione più recente.
function versioniDi(nome) {
  const inCoda = memoria.coda.map((n) => analizza(n.nome, n.contenuto, 'coda')).filter((n) => n.riferita === nome && n.tipo === 'versione');
  return [...note.filter((n) => n.riferita === nome && n.tipo === 'versione'), ...inCoda].sort((a, b) => a.nome.localeCompare(b.nome));
}
function testoDi(n) { const v = versioniDi(n.nome).pop(); return v ? v.corpo : n.corpo; }
function osservazioniDi(nome) {
  const inCoda = memoria.coda.map((n) => analizza(n.nome, n.contenuto, 'coda')).filter((n) => n.riferita === nome && n.tipo !== 'versione');
  return [...note.filter((n) => n.riferita === nome && n.cartella !== 'spettatore' && n.tipo !== 'versione'), ...inCoda].sort((a, b) => a.nome.localeCompare(b.nome));
}
function domandeDi(nome) { return note.filter((n) => n.riferita === nome && n.cartella === 'spettatore' && !n.bozza); }
function bozzeDi(nome) { return note.filter((n) => n.riferita === nome && n.bozza).sort((a, b) => (+a.bozza) - (+b.bozza)); }
// Dialogo: osservazioni dell'autore e domande dello spettatore, in ordine di tempo.
function dialogoDi(nome) {
  return [...osservazioniDi(nome), ...domandeDi(nome)].sort((a, b) => a.data.localeCompare(b.data) || a.nome.localeCompare(b.nome));
}
// Lo spettatore aspetta una risposta se l'ultimo intervento del dialogo è suo.
// Restituisce chi aspetta: null, 'spettatore' o 'drammaturgo'.
function attendeRisposta(nome) {
  const d = dialogoDi(nome); const u = d[d.length - 1];
  return u && u.cartella === 'spettatore' ? (eDrammaturgo(u) ? 'drammaturgo' : 'spettatore') : null;
}
// Come appare lo stato sulla copertina della scheda.
const FASI = { spettatore: { icona: '🎟', nome: 'spettatore' }, drammaturgo: { icona: '🎭', nome: 'drammaturgo' }, 'a-posto': { icona: '✅', nome: 'tutto a posto' } };
const statoDi = (nome) => leggi('stati', {})[nome] || 'spettatore';
const eDrammaturgo = (o) => /drammaturgo/i.test(o.autore) || (!o.autore && +o.giro >= 4);
function testoFrequenza() {
  const f = String(leggi('frequenza', '2'));
  if (f === 'sospeso') return 'Lo spettatore è sospeso: lo riattivi dalle impostazioni ⚙︎.';
  return `Lo spettatore passa ${f === '1' ? 'ogni ora' : 'ogni ' + f + ' ore'}, dalle 8 alle 22, e lascia qui le sue domande.`;
}

const PER_PAGINA = 4;
let pagina = 0;
function disegnaLista() {
  const q = $('cerca').value.trim().toLowerCase();
  const f = $('filtro-opera').value;
  const tutte = idee().filter((n) => statoDi(n.nome) !== 'cancellata');
  const elenco = tutte.filter((n) => (f === '*' || n.opera === f)
    && (!q || testoDi(n).toLowerCase().includes(q) || osservazioniDi(n.nome).some((o) => o.corpo.toLowerCase().includes(q))));
  const ul = $('lista');
  $('pagine').hidden = true;
  if (!collegata() && !tutte.length) { ul.replaceChildren(el('li', 'tenue centro', 'Collega l\'archivio dalle impostazioni ⚙︎')); return; }
  if (!elenco.length) { ul.replaceChildren(el('li', 'tenue centro', q || f !== '*' ? 'Nessuna idea trovata.' : 'Ancora nessuna idea. Tocca «＋ Idea» per scriverne una.')); return; }
  // Pagine da 4 idee, come nell'esempio scelto dall'autore.
  const totPagine = Math.ceil(elenco.length / PER_PAGINA);
  pagina = Math.min(Math.max(pagina, 0), totPagine - 1);
  const inizio = pagina * PER_PAGINA;
  const visibili = elenco.slice(inizio, inizio + PER_PAGINA);
  if (totPagine > 1) {
    $('pagine').hidden = false;
    $('pag-prima').disabled = pagina === 0;
    const restanti = elenco.length - (inizio + visibili.length);
    $('pag-dopo').disabled = restanti === 0;
    $('pag-dopo').textContent = restanti ? `Altre ${restanti} ►` : 'Altre ►';
    $('pag-numero').textContent = `${pagina + 1} di ${totPagine}`;
  }
  ul.replaceChildren(...visibili.map((n, i) => {
    const li = el('li', 'scheda' + (n.cartella === 'inbox' ? ' da-integrare' : '')); li.tabIndex = 0;
    const cop = el('div', 'copertina'); cop.style.background = tinta(n.opera, inizio + i);
    const fase = FASI[statoDi(n.nome)] || FASI.spettatore;
    cop.append(el('span', 'maschera', fase.icona), el('span', 'locandina', n.opera ? nomeOpera(n.opera) : 'Opera attiva'),
      el('span', 'fase fase-' + statoDi(n.nome), fase.nome));
    const no = dialogoDi(n.nome).length;
    const info0 = [];
    // 💬 grigio: niente di nuovo. Rosso: sono arrivate domande che non hai ancora aperto.
    if (no) cop.append(el('span', 'contatore' + (nonLetti(n.nome).length ? ' nuove' : ''), `💬 ${no}`));
    const chiede = statoDi(n.nome) === 'a-posto' ? null : attendeRisposta(n.nome);
    if (statoDi(n.nome) === 'a-posto') info0.push(el('span', 'badge integrata', '✓ tutto a posto'));
    if (chiede) info0.push(el('span', 'badge domande' + (chiede === 'drammaturgo' ? ' dramm' : ''), chiede === 'drammaturgo' ? '❓ il drammaturgo chiede' : '❓ lo spettatore chiede'));
    const info = el('div', 'info');
    info.append(el('div', 'titolo', testoDi(n) || '(vuota)'));
    info.append(el('div', 'meta', dataBreve(n.data)));
    if (n.cartella === 'coda') info.append(el('span', 'badge attesa', 'in attesa di rete'));
    else if (n.cartella === 'archivio') info.append(el('span', 'badge integrata', 'integrata nella wiki'));
    info.append(...info0);
    li.append(cop, info);
    li.addEventListener('click', () => apriDettaglio(n.nome));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') apriDettaglio(n.nome); });
    return li;
  }));
  requestAnimationFrame(adattaSchede);
}

// Se in una scheda il testo non ci sta, il titolo perde una riga alla volta (almeno una resta).
function adattaSchede() {
  document.querySelectorAll('#vista-lista .scheda .info').forEach((info) => {
    const t = info.querySelector('.titolo'); if (!t) return;
    t.style.webkitLineClamp = '';
    let righe = parseInt(getComputedStyle(t).webkitLineClamp, 10) || 3;
    while (righe > 1 && info.scrollHeight > info.clientHeight + 1) t.style.webkitLineClamp = String(--righe);
  });
}
window.addEventListener('resize', () => requestAnimationFrame(adattaSchede));

function disegnaOpere() {
  const opere = leggi('opere', []);
  for (const [id, prima] of [['opera', new Option('Opera attiva', '')], ['filtro-opera', new Option('Tutte', '*')]]) {
    const s = $(id), scelta = s.value;
    const extra = id === 'filtro-opera' ? [new Option('Opera attiva', '')] : [];
    s.replaceChildren(prima, ...extra, ...opere.map((o) => new Option(nomeOpera(o), o)));
    s.value = [...s.options].some((o) => o.value === scelta) ? scelta : prima.value;
  }
}

let ideaAperta = null, inModifica = false;
function apriDettaglio(nome) {
  inModifica = false;
  ideaAperta = nome; vista('dettaglio'); disegnaDettaglio();
}
function disegnaDettaglio() {
  const n = idee().find((x) => x.nome === ideaAperta);
  if (!n) { vista('lista'); return; }
  segnaLetti(n.nome); // ciò che vedi qui conta come letto
  // In testata solo la data (e il nome dell'opera, se è stata scelta): niente riquadro colorato.
  $('dett-titolo').textContent = (n.opera ? nomeOpera(n.opera) + ' · ' : '') + dataBreve(n.data);
  $('dett-nota').textContent = n.cartella === 'archivio' ? 'integrata nella wiki' : n.cartella === 'coda' ? 'in attesa di rete' : '';
  const ultima = versioniDi(n.nome).pop();
  $('dett-testo').textContent = testoDi(n);
  if (ultima) $('dett-nota').textContent = `✏️ modificata il ${dataBreve(ultima.data)}${ultima.cartella === 'coda' ? ' · in attesa di rete' : ''}`;
  if (!inModifica) { $('dett-testo').hidden = false; $('dett-modifica-box').hidden = true; }
  const st = statoDi(n.nome);
  document.querySelectorAll('#dett-stato button').forEach((b) => b.classList.toggle('scelta', b.dataset.s === st));
  const dialogo = dialogoDi(n.nome);
  $('dett-titolo-oss').textContent = dialogo.length ? `Osservazioni e domande (${dialogo.length})` : 'Osservazioni e domande';
  $('dett-osservazioni').replaceChildren(...(dialogo.length ? dialogo.map((o) => {
    const spett = o.cartella === 'spettatore';
    const dramm = spett && eDrammaturgo(o);
    const li = el('li', spett ? 'spett' + (dramm ? ' dramm' : '') : '');
    const chi = spett ? `${dramm ? '🎭 Il drammaturgo chiede' : '🎟 Lo spettatore chiede'}${o.giro ? ' · giro ' + o.giro : ''}` : '✍ Tu';
    li.append(el('span', 'meta', `${chi} · ${dataBreve(o.data)}${o.cartella === 'coda' ? ' · in attesa di rete' : ''}`), document.createTextNode(o.corpo)); return li;
  }) : [el('li', 'tenue', statoDi(n.nome) === 'a-posto' ? 'Nessuna domanda.' : 'Ancora niente. ' + testoFrequenza())]));
}

// ---------- Sinossi fin qui ----------
// La bozza la scrive Claude al giro successivo dello spettatore, quando trova una richiesta.
function prossimoGiro() {
  const f = String(leggi('frequenza', '2'));
  if (f === 'sospeso') return null;
  const passo = +f || 2, ora = new Date().getHours();
  for (let h = Math.max(ora + 1, 8); h <= 22; h++) if ((h - 8) % passo === 0) return `alle ${h}`;
  return 'domattina alle 8';
}
function richiestaInAttesa(nome) {
  const r = leggi('richieste', {})[nome]; if (!r) return false;
  const b = bozzeDi(nome).pop();
  return !b || r > b.data;
}
// Mostra il testo della bozza: titoli (#) in evidenza, il resto così com'è.
function testoBozza(corpo) {
  return corpo.split('\n').map((riga) => {
    const m = riga.match(/^(#{1,3})\s+(.*)$/);
    if (m) return el(m[1].length === 1 ? 'h3' : m[1].length === 2 ? 'h4' : 'h5', 'bozza-titolo', m[2].replace(/\*\*/g, ''));
    return riga.trim() ? el('p', /\[(DA CHIARIRE|PROPOSTA)\]/.test(riga) ? 'bozza-riga segnata' : 'bozza-riga', riga.replace(/\*\*/g, '')) : null;
  }).filter(Boolean);
}
function disegnaSinossi() {
  const n = idee().find((x) => x.nome === ideaAperta);
  if (!n) { vista('lista'); return; }
  const b = bozzeDi(n.nome).pop();
  $('sin-titolo').textContent = b ? `Sinossi fin qui · bozza ${b.bozza}` : 'Sinossi fin qui';
  $('sin-testo').replaceChildren(...(b
    ? [el('p', 'tenue', `Scritta il ${dataBreve(b.data)}, solo con le tue parole. [DA CHIARIRE] = ancora da decidere, [PROPOSTA] = aggiunto da Claude.`), ...testoBozza(b.corpo)]
    : [el('p', 'tenue', 'Ancora nessuna bozza per questa idea. Tocca il pulsante qui sotto: Claude la scrive al prossimo giro dello spettatore.')]));
  const aPosto = statoDi(n.nome) === 'a-posto', attesa = richiestaInAttesa(n.nome), giro = prossimoGiro();
  $('sin-chiedi').disabled = aPosto || attesa || n.cartella === 'coda';
  $('sin-chiedi').textContent = b ? '📜 Aggiorna la bozza' : '📜 Chiedi la bozza';
  mostra('sin-esito', aPosto ? "L'idea è «tutto a posto»: la sinossi vera si fa sul PC."
    : attesa ? (giro ? `Richiesta inviata ✓ La bozza arriva al prossimo giro, ${giro}.` : 'Richiesta inviata ✓ Lo spettatore è sospeso: riattivalo dalle impostazioni.')
    : '', attesa ? 'ok' : 'tenue');
}
$('dett-sinossi').addEventListener('click', () => { vista('sinossi'); disegnaSinossi(); });
$('sin-indietro').addEventListener('click', () => { vista('dettaglio'); disegnaDettaglio(); });
$('sin-chiedi').addEventListener('click', async () => {
  const idea = idee().find((x) => x.nome === ideaAperta);
  if (!idea) return;
  if (!collegata()) { mostra('sin-esito', "Prima collega l'archivio con la chiave.", 'errore'); return; }
  const t = adesso();
  $('sin-chiedi').disabled = true; mostra('sin-esito', 'Invio…', 'tenue');
  try {
    await creaFile({ nome: `${t.giorno}-${t.compatta}-sinossi.md`,
      contenuto: ['riferita_a: ' + idea.nome, 'richiesta: sinossi', 'fonte: app', `data: ${t.giorno} ${t.ora}`, ''].join('\n') },
    'spettatore/richieste', 'Sinossi fin qui, richiesta dal telefono');
    scrivi('richieste', { ...leggi('richieste', {}), [idea.nome]: `${t.giorno} ${t.ora}` });
  } catch { mostra('sin-esito', 'Non sono riuscito a inviare la richiesta: controlla la rete e riprova.', 'errore'); $('sin-chiedi').disabled = false; return; }
  disegnaSinossi();
});

// ---------- Modifica a mano del testo dell'idea ----------
// Non tocca il file originale: salva una versione nuova (inbox/…-ver-….md con tipo: versione).
function chiudiModifica() { inModifica = false; $('dett-modifica-box').hidden = true; $('dett-testo').hidden = false; }
$('dett-modifica-apri').addEventListener('click', () => {
  const n = idee().find((x) => x.nome === ideaAperta);
  if (!n) return;
  if (inModifica) { chiudiModifica(); return; }
  inModifica = true;
  $('dett-modifica').value = leggi('bozza-ver-' + n.nome, '') || testoDi(n);
  $('dett-testo').hidden = true; $('dett-modifica-box').hidden = false; mostra('oss-esito', '');
  setTimeout(() => $('dett-modifica').focus(), 50);
});
$('dett-modifica').addEventListener('input', () => scrivi('bozza-ver-' + ideaAperta, $('dett-modifica').value));
$('dett-annulla').addEventListener('click', () => { scrivi('bozza-ver-' + ideaAperta, ''); chiudiModifica(); });
$('dett-salva').addEventListener('click', () => {
  const n = idee().find((x) => x.nome === ideaAperta);
  const testo = $('dett-modifica').value;
  if (!n) return;
  if (!testo.trim()) { mostra('oss-esito', "Il testo non può restare vuoto.", 'tenue'); return; }
  if (testo.trim() === testoDi(n).trim()) { scrivi('bozza-ver-' + n.nome, ''); chiudiModifica(); return; }
  if (!memoria.chiave) { mostra('oss-esito', "Prima collega l'archivio con la chiave.", 'errore'); return; }
  memoria.coda = [...memoria.coda, preparaNota(testo, { riferita_a: n.nome, tipo: 'versione', opera: n.opera }, 'ver-')];
  scrivi('bozza-ver-' + n.nome, '');
  chiudiModifica(); mostra('oss-esito', 'Invio…', 'tenue');
  disegnaTutto();
  svuotaCoda('oss-esito');
});

// Il dialogo si apre sull'ultimo intervento, il più recente.
function scorriInFondo() { const ul = $('dett-osservazioni'); ul.scrollTop = ul.scrollHeight; }
function disegnaTutto() {
  disegnaLista();
  if (!$('vista-dettaglio').hidden) disegnaDettaglio();
  if (!$('vista-sinossi').hidden) disegnaSinossi();
}

function vista(nome) {
  fermaDettatura();
  for (const v of ['lista', 'nuova', 'dettaglio', 'sinossi', 'impostazioni']) $('vista-' + v).hidden = v !== nome;
  if (nome === 'lista') disegnaLista();
  if (nome === 'impostazioni') { $('chiave').value = memoria.chiave; $('archivio').value = memoria.archivio; mostra('esito-frequenza', ''); disegnaFrequenza(); mostra('esito-cancellate', ''); disegnaCancellate(); }
  if (nome === 'nuova') { mostra('esito', ''); setTimeout(() => $('testo').focus(), 50); }
  if (nome === 'dettaglio') { requestAnimationFrame(scorriInFondo); mostra('oss-esito', ''); $('oss-testo').value = leggi('bozza-oss-' + ideaAperta, ''); }
  window.scrollTo(0, 0);
}

// ---------- Azioni ----------
document.querySelectorAll('.indietro:not(#sin-indietro)').forEach((b) => b.addEventListener('click', () => vista('lista')));
$('nuova').addEventListener('click', () => vista('nuova'));
$('apri-impostazioni').addEventListener('click', () => vista('impostazioni'));
$('aggiorna').addEventListener('click', async () => { await caricaNote(); caricaOpere(); disegnaTutto(); });
$('cerca').addEventListener('input', () => { pagina = 0; disegnaLista(); });
$('filtro-opera').addEventListener('change', () => { pagina = 0; disegnaLista(); });
$('pag-prima').addEventListener('click', () => { pagina--; disegnaLista(); window.scrollTo(0, 0); });
$('pag-dopo').addEventListener('click', () => { pagina++; disegnaLista(); window.scrollTo(0, 0); });

$('invia').addEventListener('click', () => {
  const testo = $('testo').value;
  if (!testo.trim()) { mostra('esito', 'Scrivi prima l\'idea.', 'tenue'); return; }
  if (!memoria.chiave) { vista('impostazioni'); mostra('esito-impostazioni', 'Prima inserisci la chiave GitHub.', 'errore'); return; }
  memoria.coda = [...memoria.coda, preparaNota(testo, { opera: $('opera').value })];
  $('testo').value = ''; scrivi('bozza', '');
  pagina = 0; // la nuova idea compare in cima alla prima pagina
  mostra('esito', 'Invio…', 'tenue');
  disegnaTutto();
  svuotaCoda('esito').then(() => { if (!memoria.coda.length) setTimeout(() => vista('lista'), 700); });
});

$('oss-invia').addEventListener('click', () => {
  const testo = $('oss-testo').value;
  const idea = idee().find((x) => x.nome === ideaAperta);
  if (!testo.trim() || !idea) { mostra('oss-esito', 'Scrivi prima l\'osservazione.', 'tenue'); return; }
  memoria.coda = [...memoria.coda, preparaNota(testo, { riferita_a: idea.nome, opera: idea.opera }, 'oss-')];
  $('oss-testo').value = ''; scrivi('bozza-oss-' + ideaAperta, '');
  mostra('oss-esito', 'Invio…', 'tenue');
  disegnaTutto(); scorriInFondo();
  svuotaCoda('oss-esito');
});

// Le bozze non si perdono se l'app viene chiusa.
$('testo').addEventListener('input', () => scrivi('bozza', $('testo').value));
$('oss-testo').addEventListener('input', () => scrivi('bozza-oss-' + ideaAperta, $('oss-testo').value));

$('salva').addEventListener('click', async () => {
  const chiave = $('chiave').value.trim();
  const archivio = $('archivio').value.trim() || 'teatro-wiki';
  if (!chiave) { mostra('esito-impostazioni', 'Incolla la chiave.', 'errore'); return; }
  try { localStorage.setItem('chiave', chiave); localStorage.setItem('archivio', archivio); } catch { /* */ }
  mostra('esito-impostazioni', 'Provo…', 'tenue');
  try {
    const u = await api('/user');
    if (!u.ok) throw new Error('chiave');
    localStorage.setItem('proprietario', (await u.json()).login);
    const r = await api(repo());
    if (!r.ok) throw new Error('archivio');
    mostra('esito-impostazioni', 'Tutto a posto ✓ L\'app è collegata all\'archivio.', 'ok');
    await caricaNote(); caricaOpere(); svuotaCoda(); disegnaTutto();
    setTimeout(() => vista('lista'), 1000);
  } catch (e) {
    mostra('esito-impostazioni', e.message === 'archivio'
      ? 'La chiave funziona ma non vede l\'archivio: controlla il nome e che la chiave valga per quell\'archivio.'
      : 'La chiave non funziona (o manca la rete). Controlla di averla incollata intera.', 'errore');
  }
});

$('dimentica').addEventListener('click', () => {
  if (!confirm('Togliere la chiave da questo telefono? Le idee già inviate restano nell\'archivio.')) return;
  ['chiave', 'proprietario', 'opere', 'note', 'cache'].forEach((k) => { try { localStorage.removeItem(k); } catch { /* */ } });
  note = []; $('chiave').value = '';
  mostra('esito-impostazioni', 'Chiave tolta.', 'tenue');
  disegnaTutto();
});

window.addEventListener('online', () => svuotaCoda());

// ---------- Stato dell'idea: spettatore, drammaturgo o tutto a posto ----------
// Ogni scelta è un file nuovo in spettatore/stato/: vale il più recente.
document.querySelectorAll('#dett-stato button').forEach((b) => b.addEventListener('click', async () => {
  const idea = idee().find((x) => x.nome === ideaAperta);
  const s = b.dataset.s;
  if (!idea || s === statoDi(idea.nome)) return;
  if (!collegata()) { mostra('oss-esito', "Prima collega l'archivio con la chiave.", 'errore'); return; }
  if (idea.cartella === 'coda') { mostra('oss-esito', "L'idea non è ancora arrivata nell'archivio: riprova quando torna la rete.", 'errore'); return; }
  if (s === 'a-posto' && !confirm("Tutto a posto? Lo spettatore smette di fare domande e l'idea è pronta per il PC. Potrai sempre riaprirla.")) return;
  mostra('oss-esito', 'Salvo…', 'tenue');
  try {
    await salvaStato(idea.nome, s);
    disegnaTutto();
    mostra('oss-esito', s === 'a-posto' ? 'Fatto ✓ Idea chiusa: è pronta per il PC.' : 'Fatto ✓ Vale dal prossimo passaggio.', 'ok');
  } catch {
    mostra('oss-esito', navigator.onLine ? 'Non sono riuscito a salvare: controlla la chiave.' : 'Serve la rete per cambiare lo stato.', 'errore');
  }
}));

async function salvaStato(nome, s) {
  const t = adesso();
  const contenuto = ['riferita_a: ' + nome, 'stato: ' + s, 'fonte: app', `data: ${t.giorno} ${t.ora}`, ''].join('\n');
  await creaFile({ nome: `${t.giorno}-${t.compatta}-stato.md`, contenuto }, 'spettatore/stato', "Stato dell'idea dal telefono");
  scrivi('stati', { ...leggi('stati', {}), [nome]: s });
}

// ---------- Cestino ----------
// Cancellare un'idea non toglie il file: scrive lo stato «cancellata». L'idea sparisce dall'app,
// lo spettatore e Raccogli la ignorano, e si può ripristinare dalle impostazioni.
$('dett-cestino').addEventListener('click', async () => {
  const idea = idee().find((x) => x.nome === ideaAperta);
  if (!idea) return;
  if (!collegata()) { mostra('oss-esito', "Prima collega l'archivio con la chiave.", 'errore'); return; }
  if (idea.cartella === 'coda') { mostra('oss-esito', "L'idea non è ancora arrivata nell'archivio: riprova quando torna la rete.", 'errore'); return; }
  if (!confirm("Vuoi davvero cancellare questa idea?\n\nSparisce dall'app e lo spettatore non ci lavora più. Il testo resta salvato nell'archivio: puoi ripristinarla da Impostazioni ⚙︎ → Idee cancellate.")) return;
  mostra('oss-esito', 'Cancello…', 'tenue');
  try {
    await salvaStato(idea.nome, 'cancellata');
    vista('lista');
    mostra('stato-lista', 'Idea cancellata ✓ La ritrovi in Impostazioni.', 'ok centro');
    setTimeout(() => mostra('stato-lista', '', ''), 4000);
  } catch {
    mostra('oss-esito', navigator.onLine ? 'Non sono riuscito a cancellare: controlla la chiave.' : 'Serve la rete per cancellare.', 'errore');
  }
});
function disegnaCancellate() {
  const via = idee().filter((n) => statoDi(n.nome) === 'cancellata');
  $('titolo-cancellate').hidden = !via.length;
  $('cancellate').replaceChildren(...via.map((n) => {
    const li = el('li', 'cancellata');
    const b = el('button', 'ripristina', 'Ripristina');
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await salvaStato(n.nome, 'spettatore'); disegnaCancellate(); disegnaLista(); mostra('esito-cancellate', 'Idea ripristinata ✓', 'ok'); }
      catch { b.disabled = false; mostra('esito-cancellate', 'Non sono riuscito: controlla la rete.', 'errore'); }
    });
    li.append(el('span', 'testo', testoDi(n)), b);
    return li;
  }));
}

// ---------- Aspetto: tema dei colori (resta solo su questo telefono) ----------
const TEMI = { scuro: '#0f0f0f', pergamena: '#dcc08a', carta: '#e8dcc0', fluo: '#07060d' };
function applicaTema(t) {
  t = { pastello: 'pergamena', notte: 'fluo' }[t] || t;
  if (!TEMI[t]) t = 'scuro';
  document.documentElement.dataset.tema = t;
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = TEMI[t];
  document.querySelectorAll('#tema button').forEach((b) => b.classList.toggle('scelta', b.dataset.t === t));
}
document.querySelectorAll('#tema button').forEach((b) => b.addEventListener('click', () => {
  scrivi('tema', b.dataset.t); applicaTema(b.dataset.t); disegnaTutto();
}));
applicaTema(leggi('tema', 'scuro'));

// ---------- Ogni quanto passa lo spettatore ----------
// La scelta si scrive nell'archivio come file nuovo in spettatore/frequenza/: la routine legge il più recente.
function disegnaFrequenza() {
  const f = String(leggi('frequenza', '2'));
  document.querySelectorAll('#frequenza button').forEach((b) => b.classList.toggle('scelta', b.dataset.f === f));
  $('frequenza-attuale').textContent = testoFrequenza();
}
document.querySelectorAll('#frequenza button').forEach((b) => b.addEventListener('click', async () => {
  if (!collegata()) { mostra('esito-frequenza', "Prima collega l'archivio con la chiave.", 'errore'); return; }
  const f = b.dataset.f, t = adesso();
  mostra('esito-frequenza', 'Salvo…', 'tenue');
  try {
    const contenuto = ['frequenza: ' + f, 'fonte: app', `data: ${t.giorno} ${t.ora}`, ''].join('\n');
    await creaFile({ nome: `${t.giorno}-${t.compatta}-frequenza.md`, contenuto },'spettatore/frequenza', 'Spettatore, frequenza dal telefono');
    scrivi('frequenza', f); disegnaFrequenza(); disegnaTutto();
    mostra('esito-frequenza', 'Fatto ✓ Vale dal prossimo passaggio.', 'ok');
  } catch {
    mostra('esito-frequenza', navigator.onLine ? 'Non sono riuscito a salvare: controlla la chiave.' : 'Serve la rete per cambiare la frequenza.', 'errore');
  }
}));

// ---------- Microfono con la maschera: dettatura in ogni casella di testo ----------
// Usa il riconoscimento vocale del telefono (Chrome su Android, Safari su iPhone).
const Riconoscimento = window.SpeechRecognition || window.webkitSpeechRecognition;
let ascolto = null;
function fermaDettatura() { if (ascolto) { try { ascolto.r.stop(); } catch { /* */ } } }
function preparaMicrofoni() {
  document.querySelectorAll('[data-detta]').forEach((campo) => {
    const b = el('button', 'microfono'); b.type = 'button'; b.setAttribute('aria-label', 'Detta a voce');
    b.append(el('span', 'm-maschera', '🎭'), el('span', 'm-mic', '🎤'));
    // data-mic-in: il microfono va in un altro posto (per esempio accanto ai pulsanti di stato).
    const posto = campo.dataset.micIn && $(campo.dataset.micIn);
    if (posto) { b.classList.add('fuori'); posto.append(b); } else {
      const box = el('div', 'campo-voce' + (campo.tagName === 'INPUT' ? ' riga' : ''));
      campo.parentNode.insertBefore(box, campo); box.append(campo, b);
    }
    b.addEventListener('click', () => detta(campo, b));
  });
}
function detta(campo, b) {
  if (!Riconoscimento) { alert('Su questo telefono l\'app non può usare il microfono. Puoi dettare con il microfono della tastiera.'); return; }
  if (ascolto) { const era = ascolto.campo; fermaDettatura(); if (era === campo) return; }
  const r = new Riconoscimento();
  r.lang = 'it-IT'; r.interimResults = true; r.continuous = true;
  const base = campo.value ? campo.value.replace(/\s*$/, ' ') : '';
  const segnaposto = campo.placeholder;
  let definitivo = '';
  r.onresult = (e) => {
    let provvisorio = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) definitivo += t; else provvisorio += t;
    }
    campo.value = base + definitivo + provvisorio;
    campo.dispatchEvent(new Event('input'));
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') alert('Per dettare, permetti all\'app di usare il microfono (te lo chiede il telefono).');
  };
  r.onend = () => {
    b.classList.remove('attivo'); campo.placeholder = segnaposto;
    campo.value = (base + definitivo).replace(/\s+$/, '');
    campo.dispatchEvent(new Event('input'));
    if (ascolto && ascolto.r === r) ascolto = null;
  };
  ascolto = { r, campo };
  b.classList.add('attivo'); campo.placeholder = 'Ti ascolto… tocca di nuovo la maschera per finire';
  try { r.start(); } catch { b.classList.remove('attivo'); ascolto = null; }
}

// ---------- Avvio ----------
preparaMicrofoni();
$('testo').value = leggi('bozza', '');
disegnaOpere(); disegnaTutto();
if (!memoria.chiave) vista('impostazioni');
else { caricaNote().then(disegnaTutto); caricaOpere(); svuotaCoda(); }
// Con l'app aperta controlla le domande nuove ogni 5 minuti e quando torna in primo piano.
let ultimoControllo = Date.now();
function controllaDomande() {
  if (!memoria.chiave || document.visibilityState !== 'visible') return;
  ultimoControllo = Date.now(); caricaNote().then(disegnaTutto);
}
setInterval(controllaDomande, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - ultimoControllo > 30000) controllaDomande(); });
// Aggiornamenti: a ogni apertura (e quando l'app torna in primo piano) controlla se c'è una
// versione nuova; se c'è, la attiva e ricarica la pagina una volta sola.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const avevaControllo = !!navigator.serviceWorker.controller;
  let ricaricata = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (avevaControllo && !ricaricata) { ricaricata = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    reg.update();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update(); });
  });
}
