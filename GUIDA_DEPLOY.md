# Guida al deploy — Diario Allenamento

Il mio ambiente non può raggiungere supabase.com o netlify.com direttamente (sandbox di rete limitata), quindi questi comandi vanno eseguiti da un terminale sul tuo computer. Sono pensati per essere copia-incollati senza pensarci troppo.

## 1. Anteprima locale (prima di pubblicare)

```bash
cd diario
python3 -m http.server 8080
```
Apri `http://localhost:8080` — noterai che senza URL/chiave Supabase reali le chiamate falliranno (è normale, sistemato al passo 2).

## 2. Creare il progetto Supabase (nuovo, separato dal Calcolatore carichi)

```bash
npm install -g supabase
supabase login
# incolla il tuo access token quando richiesto

supabase projects create diario-allenamento --org-id <TUA_ORG_ID> --db-password <SCEGLI_UNA_PASSWORD> --region eu-central-1
```
Se non conosci `<TUA_ORG_ID>`: `supabase orgs list`

Prendi nota di **Project Ref** e **Project URL** restituiti.

## 3. Applicare lo schema

```bash
supabase link --project-ref <PROJECT_REF>
supabase db push --file schema.sql
```
(Se `db push --file` non è supportato dalla tua versione CLI, in alternativa apri il **SQL Editor** nella dashboard Supabase e incolla il contenuto di `schema.sql`, poi Run.)

## 4. Deploy della Edge Function di sola lettura

```bash
supabase functions deploy riepilogo --project-ref <PROJECT_REF> --no-verify-jwt
```
L'URL finale sarà: `https://<PROJECT_REF>.supabase.co/functions/v1/riepilogo`

## 5. Recuperare URL e anon key del progetto

Dashboard Supabase → Project Settings → API:
- **Project URL** → va in `SUPABASE_URL`
- **anon public key** → va in `SUPABASE_ANON_KEY`

Apri `index.html`, cerca queste due righe vicino all'inizio dello script e sostituiscile:
```js
const SUPABASE_URL = 'INSERISCI_QUI_URL_PROGETTO_SUPABASE';
const SUPABASE_ANON_KEY = 'INSERISCI_QUI_ANON_KEY';
```

## 6. Deploy dell'app (Netlify Drop — zero configurazione)

1. Vai su https://app.netlify.com/drop
2. Trascina l'intera cartella `diario` (quella con `index.html`, `manifest.json`, `sw.js`, le icone) nella pagina
3. Netlify ti dà subito un URL pubblico (es. `https://nome-a-caso.netlify.app`)
4. (Opzionale) Rinomina il sito da Site settings → Change site name

In alternativa, se sei già loggato via CLI:
```bash
npm install -g netlify-cli
netlify login
netlify deploy --prod --dir=diario
```

## 7. Keep-alive (nessun repo GitHub disponibile → monitor esterno gratuito)

1. Vai su https://cron-job.org e crea un account gratuito
2. Crea un nuovo cron job:
   - **URL**: `https://<PROJECT_REF>.supabase.co/rest/v1/config?select=id&limit=1`
   - **Header richiesto**: `apikey: <LA_TUA_ANON_KEY>`
   - **Schedule**: una volta al giorno (es. ogni giorno alle 6:00)
3. Salva — questo mantiene attivo il progetto Supabase free tier con una query REST reale giornaliera

## 8. Installazione PWA sulla home del telefono

**Android (Chrome):**
1. Apri l'URL dell'app in Chrome
2. Tocca i tre puntini in alto a destra → "Aggiungi a schermata Home" (o comparirà un banner automatico "Installa app")
3. Conferma — l'icona apparirà come una app normale

**iOS (Safari — l'installabilità dipende dai meta tag apple-mobile-web-app-*, non dal service worker):**
1. Apri l'URL dell'app in **Safari** (non funziona da Chrome su iOS)
2. Tocca l'icona Condividi (quadrato con freccia verso l'alto)
3. Scorri e tocca "Aggiungi alla schermata Home"
4. Conferma il nome e tocca "Aggiungi"

---

## Checklist manuale finale (cortissima)

- [ ] Progetto Supabase creato (nuovo, separato)
- [ ] `schema.sql` applicato
- [ ] Edge Function `riepilogo` deployata
- [ ] `SUPABASE_URL` e `SUPABASE_ANON_KEY` inseriti in `index.html`
- [ ] Cartella `diario` trascinata su Netlify Drop
- [ ] Cron job giornaliero su cron-job.org configurato
- [ ] Tmax/Smax impostati in Impostazioni (altrimenti le prescrizioni a percentuale restano "da definire")
- [ ] App installata sulla home del telefono (Android e/o iOS)
- [ ] URL finale app + URL Edge Function annotati da qualche parte

**URL Edge Function (da compilare dopo il deploy, separato dall'URL app):**
`https://<PROJECT_REF>.supabase.co/functions/v1/riepilogo`
