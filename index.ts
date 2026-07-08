// Supabase Edge Function: "riepilogo"
// Endpoint pubblico di SOLA LETTURA, nessuna autenticazione.
// Restituisce un JSON pensato per essere letto e analizzato da uno
// strumento esterno (es. Claude via web-fetch).
//
// Deploy: supabase functions deploy riepilogo --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TIMEZONE = "Europe/Rome";

function oggiRoma(): string {
  // Data odierna (YYYY-MM-DD) nel fuso Europe/Rome, indipendente dal fuso del server.
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date()); // en-CA => YYYY-MM-DD
}

function dataDaStringa(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function differenzaGiorni(a: string, b: string): number {
  const da = dataDaStringa(a).getTime();
  const db = dataDaStringa(b).getTime();
  return Math.round((db - da) / 86400000);
}

function lunediSettimana(dataISO: string): string {
  const d = dataDaStringa(dataISO);
  const giornoSettimana = d.getUTCDay(); // 0 = domenica, 1 = lunedì...
  const offset = giornoSettimana === 0 ? 6 : giornoSettimana - 1;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function primoGiornoMese(dataISO: string): string {
  const [y, m] = dataISO.split("-");
  return `${y}-${m}-01`;
}

Deno.serve(async (_req: Request) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const oggi = oggiRoma();
    const inizioSettimanaCorrente = lunediSettimana(oggi);
    const inizioMeseCorrente = primoGiornoMese(oggi);
    const trentaGiorniFa = new Date(dataDaStringa(oggi).getTime() - 30 * 86400000).toISOString().slice(0, 10);

    // --- 1. Sessioni ultimi 30 giorni ---
    const { data: logRecenti, error: errLog } = await sb
      .from("log_sessioni")
      .select("id, esercizio_id, data, peso, serie, ripetizioni, fatto, nota, esercizi(nome, tipo)")
      .eq("eliminato", false)
      .gte("data", trentaGiorniFa)
      .order("data", { ascending: false });
    if (errLog) throw errLog;

    const sessioniUltimi30Giorni = (logRecenti ?? []).map((r: any) => ({
      esercizio: r.esercizi?.nome ?? null,
      data: r.data,
      peso: r.peso,
      serie: r.serie,
      ripetizioni: r.ripetizioni,
      fatto: r.fatto,
      nota: r.nota,
    }));

    // --- 2. Esercizi attivi: giorni dall'ultimo log vs target ---
    const { data: eserciziAttivi, error: errEs } = await sb
      .from("esercizi")
      .select("id, nome, tipo, target_giorni")
      .eq("archiviato", false)
      .eq("eliminato", false);
    if (errEs) throw errEs;

    const { data: tuttiLog, error: errTuttiLog } = await sb
      .from("log_sessioni")
      .select("esercizio_id, data, peso, serie, ripetizioni")
      .eq("eliminato", false);
    if (errTuttiLog) throw errTuttiLog;

    const aderenza = (eserciziAttivi ?? []).map((es: any) => {
      const logEsercizio = (tuttiLog ?? []).filter((l: any) => l.esercizio_id === es.id);
      let ultimaData: string | null = null;
      for (const l of logEsercizio) {
        if (!ultimaData || l.data > ultimaData) ultimaData = l.data;
      }
      const giorniDaUltimoLog = ultimaData ? differenzaGiorni(ultimaData, oggi) : null;
      return {
        esercizio: es.nome,
        tipo: es.tipo,
        target_giorni: es.target_giorni,
        ultima_data_log: ultimaData,
        giorni_da_ultimo_log: giorniDaUltimoLog,
        mai_eseguito: ultimaData === null,
        in_ritardo: giorniDaUltimoLog !== null && giorniDaUltimoLog > es.target_giorni,
      };
    });

    // --- 3. Volume e carico massimo per esercizi 'carico' (settimana e mese correnti) ---
    function aggregato(logs: any[], desde: string) {
      const filtrati = logs.filter((l: any) => l.data >= desde && l.peso != null);
      const volumeTotale = filtrati.reduce((acc: number, l: any) => acc + (l.peso * (l.serie ?? 0) * (l.ripetizioni ?? 0)), 0);
      const caricoMassimo = filtrati.reduce((max: number, l: any) => Math.max(max, l.peso ?? 0), 0);
      return { volume_totale: volumeTotale, carico_massimo: caricoMassimo };
    }

    const volumeECarico = (eserciziAttivi ?? [])
      .filter((es: any) => es.tipo === "carico")
      .map((es: any) => {
        const logEsercizio = (tuttiLog ?? []).filter((l: any) => l.esercizio_id === es.id);
        return {
          esercizio: es.nome,
          settimana_corrente: aggregato(logEsercizio, inizioSettimanaCorrente),
          mese_corrente: aggregato(logEsercizio, inizioMeseCorrente),
        };
      });

    // --- 4. Prescrizioni della settimana corrente ---
    const { data: prescrizioniSettimana, error: errPresc } = await sb
      .from("prescrizioni")
      .select("id, esercizio_id, carico_tipo, percentuale, kg, kg_calcolato_snapshot, riferimento, serie, ripetizioni, fatta, esercizi(nome)")
      .eq("settimana_inizio", inizioSettimanaCorrente);
    if (errPresc) throw errPresc;

    const prescrizioni = (prescrizioniSettimana ?? []).map((p: any) => ({
      esercizio: p.esercizi?.nome ?? null,
      carico_tipo: p.carico_tipo,
      percentuale: p.percentuale,
      kg: p.carico_tipo === "kg_diretto" ? p.kg : p.kg_calcolato_snapshot,
      riferimento: p.riferimento,
      serie: p.serie,
      ripetizioni: p.ripetizioni,
      fatta: p.fatta,
    }));

    const risposta = {
      generato_il: oggi,
      fuso_orario: TIMEZONE,
      sessioni_ultimi_30_giorni: sessioniUltimi30Giorni,
      aderenza_esercizi_attivi: aderenza,
      volume_e_carico_massimo: volumeECarico,
      prescrizioni_settimana_corrente: {
        settimana_inizio: inizioSettimanaCorrente,
        prescrizioni: prescrizioni,
      },
    };

    return new Response(JSON.stringify(risposta, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ errore: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
});
