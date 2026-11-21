// Idee: manda le idee dal telefono nella cartella inbox/ dell'archivio privato.
// Nessun dato personale è scritto in questo codice: chiave e nome dell'archivio
// restano solo nel telefono (localStorage).
'use strict';

const $ = (id) => document.getElementById(id);
const API = 'https://api.github.com';
const memoria = {
  get chiave() { return localStorage.getItem('chiave') || ''; },
  get archivio() { return localStorage.getItem('archivio') || 'teatro-wiki'; },
  get proprietario() { return localStorage.getItem('proprietario') || ''; },
  get coda() { return JSON.parse(localStorage.getItem('coda') || '[]'); },
  set coda(v) { localStorage.setItem('coda', JSON.stringify(v)); },
};

// ---------- GitHub ----------
async function api(percorso, opzioni = {}) {
  const risposta = await fetch(API + percorso, {
    ...opzioni,
    headers: {
      Authorization: 'Bearer ' + memoria.chiave,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opzioni.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  return risposta;
}
const percorsoArchivio = () =>
  `/repos/${encodeURIComponent(memoria.proprietario)}/${encodeURIComponent(memoria.archivio)}`;

function inBase64(testo) {
  const byte = new TextEncoder().encode(testo);
  let s = '';
  for (let i = 0; i < byte.length; i += 0x8000) s += String.fromCharCode(...byte.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- Nota ----------
function due(n) { return String(n).padStart(2, '0'); }
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
function preparaNota(testo, opera) {
  const t = adesso();
  const righe = [];
  if (opera) righe.push(`opera: ${opera}`);
  righe.push('fonte: app', `data: ${t.giorno} ${t.ora}`, '', testo.trim(), '');
  return { nome: `${t.giorno}-${t.compatta}-${titoletto(testo)}.md`, contenuto: righe.join('\n') };
}

// Crea il file senza mai sovrascrivere: se il nome esiste già, aggiunge -2, -3…
async function creaFile(nota) {
  for (let n = 1; n <= 9; n++) {
    const nome = n === 1 ? nota.nome : nota.nome.replace(/\.md$/, `-${n}.md`);
    const r = await api(`${percorsoArchivio()}/contents/inbox/${encodeURIComponent(nome)}`, {
      method: 'PUT',
      body: JSON.stringify({ message: `Nuova idea dal telefono: ${nome}`, content: inBase64(nota.contenuto) }),
    });
    if (r.status === 201) return nome;
    if (r.status === 422) continue; // esiste già: prova un altro nome
    const e = new Error('http ' + r.status); e.stato = r.status; throw e;
  }
  throw new Error('troppi nomi uguali');
}

// ---------- Coda (funziona anche senza rete) ----------
let invioInCorso = false;
async function svuotaCoda() {
  if (invioInCorso || !memoria.chiave || !memoria.proprietario) return;
  invioInCorso = true;
  try {
    let coda = memoria.coda;
    while (coda.length) {
      try {
        await creaFile(coda[0]);
      } catch (e) {
        if (e.stato === 401 || e.stato === 403 || e.stato === 404) {
          mostra('esito', 'La chiave non funziona più: controllala nelle impostazioni. L\'idea è salvata qui.', 'errore');
        } else {
          mostra('esito', 'Niente rete: l\'idea è salvata qui e parte appena torna la connessione.', 'tenue');
        }
        break;
      }
      coda = memoria.coda.slice(1);
      memoria.coda = coda;
      mostra('esito', 'Idea arrivata nell\'archivio ✓', 'ok');
    }
  } finally {
    invioInCorso = false;
    disegnaAttesa();
    caricaRecenti();
  }
}

// ---------- Interfaccia ----------
function mostra(id, testo, classe = '') { const el = $(id); el.textContent = testo; el.className = classe; }

function disegnaAttesa() {
  const coda = memoria.coda;
  $('sezione-attesa').hidden = coda.length === 0;
  $('lista-attesa').replaceChildren(...coda.map((n) => {
    const li = document.createElement('li'); li.textContent = n.nome; return li;
  }));
}

async function caricaRecenti() {
  if (!memoria.chiave || !memoria.proprietario || !navigator.onLine) return;
  try {
    const r = await api(`${percorsoArchivio()}/contents/inbox`);
    if (!r.ok) return;
    const file = (await r.json())
      .filter((f) => f.type === 'file' && f.name.endsWith('.md') && f.name !== 'LEGGIMI.md')
      .map((f) => f.name).sort().reverse().slice(0, 8);
    $('lista-recenti').replaceChildren(...(file.length ? file : ['Nessuna idea in attesa di essere integrata.']).map((nome) => {
      const li = document.createElement('li'); li.textContent = nome;
      if (!file.length) li.className = 'tenue';
      return li;
    }));
  } catch { /* senza rete: si riprova più tardi */ }
}

async function caricaOpere() {
  if (!memoria.chiave || !memoria.proprietario || !navigator.onLine) return;
  try {
    const r = await api(`${percorsoArchivio()}/contents/wiki/opere`);
    if (!r.ok) return;
    const opere = (await r.json()).filter((f) => f.type === 'dir' && !f.name.startsWith('_')).map((f) => f.name);
    localStorage.setItem('opere', JSON.stringify(opere));
    disegnaOpere();
  } catch { /* uso l'elenco salvato */ }
}
function disegnaOpere() {
  const opere = JSON.parse(localStorage.getItem('opere') || '[]');
  const scelta = $('opera').value;
  const prima = new Option('Opera attiva', '');
  $('opera').replaceChildren(prima, ...opere.map((o) => new Option(o, o)));
  $('opera').value = opere.includes(scelta) ? scelta : '';
}

function vista(nome) {
  $('vista-idea').hidden = nome !== 'idea';
  $('vista-impostazioni').hidden = nome !== 'impostazioni';
  if (nome === 'impostazioni') { $('chiave').value = memoria.chiave; $('archivio').value = memoria.archivio; }
}

$('invia').addEventListener('click', () => {
  const testo = $('testo').value;
  if (!testo.trim()) { mostra('esito', 'Scrivi prima l\'idea.', 'tenue'); return; }
  if (!memoria.chiave) { vista('impostazioni'); mostra('esito-impostazioni', 'Prima inserisci la chiave GitHub.', 'errore'); return; }
  memoria.coda = [...memoria.coda, preparaNota(testo, $('opera').value)];
  $('testo').value = ''; localStorage.removeItem('bozza');
  mostra('esito', 'Invio…', 'tenue');
  disegnaAttesa();
  svuotaCoda();
});

// La bozza non si perde se l'app viene chiusa.
$('testo').addEventListener('input', () => localStorage.setItem('bozza', $('testo').value));

$('apri-impostazioni').addEventListener('click', () => vista('impostazioni'));
$('chiudi-impostazioni').addEventListener('click', () => vista('idea'));

$('salva').addEventListener('click', async () => {
  const chiave = $('chiave').value.trim();
  const archivio = $('archivio').value.trim() || 'teatro-wiki';
  if (!chiave) { mostra('esito-impostazioni', 'Incolla la chiave.', 'errore'); return; }
  localStorage.setItem('chiave', chiave);
  localStorage.setItem('archivio', archivio);
  mostra('esito-impostazioni', 'Provo…', 'tenue');
  try {
    const u = await api('/user');
    if (!u.ok) throw new Error('chiave');
    localStorage.setItem('proprietario', (await u.json()).login);
    const r = await api(percorsoArchivio());
    if (!r.ok) throw new Error('archivio');
    mostra('esito-impostazioni', 'Tutto a posto ✓ L\'app è collegata all\'archivio.', 'ok');
    caricaOpere(); caricaRecenti(); svuotaCoda();
    setTimeout(() => vista('idea'), 1200);
  } catch (e) {
    mostra('esito-impostazioni', e.message === 'archivio'
      ? 'La chiave funziona ma non vede l\'archivio: controlla il nome e che la chiave valga per quell\'archivio.'
      : 'La chiave non funziona (o manca la rete). Controlla di averla incollata intera.', 'errore');
  }
});

$('dimentica').addEventListener('click', () => {
  if (!confirm('Togliere la chiave da questo telefono? Le idee già inviate restano nell\'archivio.')) return;
  ['chiave', 'proprietario', 'opere'].forEach((k) => localStorage.removeItem(k));
  $('chiave').value = '';
  mostra('esito-impostazioni', 'Chiave tolta.', 'tenue');
});

window.addEventListener('online', svuotaCoda);

// ---------- Avvio ----------
$('testo').value = localStorage.getItem('bozza') || '';
disegnaOpere(); disegnaAttesa();
if (!memoria.chiave) vista('impostazioni'); else { caricaOpere(); caricaRecenti(); svuotaCoda(); }
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
