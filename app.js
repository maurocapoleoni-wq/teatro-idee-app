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
  return { nome, cartella, opera: testa.opera || '', riferita: testa.riferita_a || '', data, corpo };
}

// Crea il file senza mai sovrascrivere: se il nome esiste già, aggiunge -2, -3…
async function creaFile(nota) {
  for (let n = 1; n <= 9; n++) {
    const nome = n === 1 ? nota.nome : nota.nome.replace(/\.md$/, `-${n}.md`);
    const r = await api(`${repo()}/contents/inbox/${encodeURIComponent(nome)}`, {
      method: 'PUT',
      body: JSON.stringify({ message: `Dal telefono: ${nome}`, content: inBase64(nota.contenuto) }),
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
    const albero = (await r.json()).tree.filter((f) => f.type === 'blob' && /^inbox\/(archivio\/)?[^/]+\.md$/.test(f.path) && !f.path.endsWith('LEGGIMI.md'));
    const cache = leggi('cache', {});
    const daScaricare = albero.filter((f) => !cache[f.sha]);
    for (let i = 0; i < daScaricare.length; i += 6) {
      await Promise.all(daScaricare.slice(i, i + 6).map(async (f) => {
        const b = await api(`${repo()}/git/blobs/${f.sha}`);
        if (b.ok) cache[f.sha] = daBase64((await b.json()).content);
      }));
    }
    const vivi = {};
    note = albero.filter((f) => cache[f.sha] !== undefined).map((f) => {
      vivi[f.sha] = cache[f.sha];
      const nome = f.path.split('/').pop();
      return analizza(nome, cache[f.sha], f.path.includes('/archivio/') ? 'archivio' : 'inbox');
    });
    scrivi('cache', vivi); scrivi('note', note);
    mostra('stato-lista', '', '');
  } catch {
    mostra('stato-lista', navigator.onLine ? 'Non riesco a leggere l\'archivio. Controlla la chiave.' : 'Senza rete: mostro l\'ultima copia.', 'tenue centro');
  }
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
function tinta(opera) {
  if (!opera) return 'linear-gradient(135deg,#4b3f39,#7a6a60)';
  let h = 0; for (const c of opera) h = (h * 31 + c.charCodeAt(0)) >>> 0;
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
function osservazioniDi(nome) {
  const inCoda = memoria.coda.map((n) => analizza(n.nome, n.contenuto, 'coda')).filter((n) => n.riferita === nome);
  return [...note.filter((n) => n.riferita === nome), ...inCoda].sort((a, b) => a.nome.localeCompare(b.nome));
}

function disegnaLista() {
  const q = $('cerca').value.trim().toLowerCase();
  const f = $('filtro-opera').value;
  const tutte = idee();
  const elenco = tutte.filter((n) => (f === '*' || n.opera === f)
    && (!q || n.corpo.toLowerCase().includes(q) || osservazioniDi(n.nome).some((o) => o.corpo.toLowerCase().includes(q))));
  const ul = $('lista');
  if (!collegata() && !tutte.length) { ul.replaceChildren(el('li', 'tenue centro', 'Collega l\'archivio dalle impostazioni ⚙︎')); return; }
  if (!elenco.length) { ul.replaceChildren(el('li', 'tenue centro', q || f !== '*' ? 'Nessuna idea trovata.' : 'Ancora nessuna idea. Tocca ＋ per scriverne una.')); return; }
  ul.replaceChildren(...elenco.map((n) => {
    const li = el('li', 'scheda'); li.tabIndex = 0;
    const cop = el('div', 'copertina'); cop.style.background = tinta(n.opera);
    cop.append(el('span', 'maschera', '🎭'), el('span', 'locandina', n.opera ? nomeOpera(n.opera) : 'Opera attiva'));
    const no = osservazioniDi(n.nome).length;
    if (no) cop.append(el('span', 'contatore', `💬 ${no}`));
    const info = el('div', 'info');
    info.append(el('div', 'titolo', n.corpo || '(vuota)'));
    info.append(el('div', 'meta', dataBreve(n.data)));
    if (n.cartella === 'coda') info.append(el('span', 'badge attesa', 'in attesa di rete'));
    else if (n.cartella === 'archivio') info.append(el('span', 'badge integrata', 'integrata nella wiki'));
    li.append(cop, info);
    li.addEventListener('click', () => apriDettaglio(n.nome));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') apriDettaglio(n.nome); });
    return li;
  }));
}

function disegnaOpere() {
  const opere = leggi('opere', []);
  for (const [id, prima] of [['opera', new Option('Opera attiva', '')], ['filtro-opera', new Option('Tutte', '*')]]) {
    const s = $(id), scelta = s.value;
    const extra = id === 'filtro-opera' ? [new Option('Opera attiva', '')] : [];
    s.replaceChildren(prima, ...extra, ...opere.map((o) => new Option(nomeOpera(o), o)));
    s.value = [...s.options].some((o) => o.value === scelta) ? scelta : prima.value;
  }
}

let ideaAperta = null;
function apriDettaglio(nome) {
  ideaAperta = nome; vista('dettaglio'); disegnaDettaglio();
}
function disegnaDettaglio() {
  const n = idee().find((x) => x.nome === ideaAperta);
  if (!n) { vista('lista'); return; }
  const t = $('dett-testata'); t.style.background = tinta(n.opera);
  t.replaceChildren(el('div', '', nomeOpera(n.opera)), el('div', 'meta', dataBreve(n.data)
    + (n.cartella === 'archivio' ? ' · integrata nella wiki' : n.cartella === 'coda' ? ' · in attesa di rete' : ''))) ;
  $('dett-testo').textContent = n.corpo;
  const oss = osservazioniDi(n.nome);
  $('dett-titolo-oss').textContent = oss.length ? `Osservazioni (${oss.length})` : 'Osservazioni';
  $('dett-osservazioni').replaceChildren(...(oss.length ? oss.map((o) => {
    const li = el('li'); li.append(el('span', 'meta', dataBreve(o.data) + (o.cartella === 'coda' ? ' · in attesa di rete' : '')), document.createTextNode(o.corpo)); return li;
  }) : [el('li', 'tenue', 'Nessuna osservazione per ora.')]));
}

function disegnaTutto() {
  disegnaLista();
  if (!$('vista-dettaglio').hidden) disegnaDettaglio();
}

function vista(nome) {
  for (const v of ['lista', 'nuova', 'dettaglio', 'impostazioni']) $('vista-' + v).hidden = v !== nome;
  if (nome === 'impostazioni') { $('chiave').value = memoria.chiave; $('archivio').value = memoria.archivio; }
  if (nome === 'nuova') { mostra('esito', ''); setTimeout(() => $('testo').focus(), 50); }
  if (nome === 'dettaglio') { mostra('oss-esito', ''); $('oss-testo').value = leggi('bozza-oss-' + ideaAperta, ''); }
  window.scrollTo(0, 0);
}

// ---------- Azioni ----------
document.querySelectorAll('.indietro').forEach((b) => b.addEventListener('click', () => vista('lista')));
$('nuova').addEventListener('click', () => vista('nuova'));
$('apri-impostazioni').addEventListener('click', () => vista('impostazioni'));
$('aggiorna').addEventListener('click', async () => { await caricaNote(); caricaOpere(); disegnaTutto(); });
$('cerca').addEventListener('input', disegnaLista);
$('filtro-opera').addEventListener('change', disegnaLista);

$('invia').addEventListener('click', () => {
  const testo = $('testo').value;
  if (!testo.trim()) { mostra('esito', 'Scrivi prima l\'idea.', 'tenue'); return; }
  if (!memoria.chiave) { vista('impostazioni'); mostra('esito-impostazioni', 'Prima inserisci la chiave GitHub.', 'errore'); return; }
  memoria.coda = [...memoria.coda, preparaNota(testo, { opera: $('opera').value })];
  $('testo').value = ''; scrivi('bozza', '');
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
  disegnaTutto();
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

// ---------- Avvio ----------
$('testo').value = leggi('bozza', '');
disegnaOpere(); disegnaTutto();
if (!memoria.chiave) vista('impostazioni');
else { caricaNote().then(disegnaTutto); caricaOpere(); svuotaCoda(); }
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
