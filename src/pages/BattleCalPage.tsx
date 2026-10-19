import { Layout } from "../components/Layout";

interface BattleCalPageProps {
  onBack: () => void;
  onCreateGame: () => void;
  onOpenStats: () => void;
}

// Battle-Cal (hinter Schalter, Standard AUS). Die App selbst ist die statische Seite /battle-cal/ (src/battle-cal/battle-cal.html);
// sie spricht die Datenbank nur ueber die RPCs public.bc_* an. Hier wird sie im Match-Tracker-Rahmen eingebettet.
// Kein eigenes Match-Tracker-Menue (☰) auf dieser Seite: Battle-Cal hat ein eigenes, zurueck geht ueber "Zurück" (UX-Befund A).
export const BATTLE_CAL_APP_URL = "/battle-cal/";

export const BattleCalPage = ({ onBack }: BattleCalPageProps) => (
  <Layout title="Battle-Cal" onBack={onBack}>
    <iframe
      className="battle-cal-frame"
      title="Battle-Cal"
      src={BATTLE_CAL_APP_URL}
      style={{ display: "block", width: "100%", height: "calc(100dvh - 96px)", minHeight: 480, border: 0, borderRadius: 12, background: "#0b0f14" }}
    />
  </Layout>
);
