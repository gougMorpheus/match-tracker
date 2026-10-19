import { FloatingMenu } from "../components/FloatingMenu";
import { Layout } from "../components/Layout";
import { getBattleCalMenuItems } from "../utils/battleCalFeature";

interface BattleCalPageProps {
  onBack: () => void;
  onCreateGame: () => void;
  onOpenStats: () => void;
}

// Platzhalter (Vorschau hinter Schalter). Die eigentliche Battle-Cal-App folgt nach der Datenuebernahme.
export const BattleCalPage = ({ onBack, onCreateGame, onOpenStats }: BattleCalPageProps) => (
  <Layout
    title="Battle-Cal"
    onBack={onBack}
    actions={
      <FloatingMenu
        fixed
        ariaLabel="Hauptmenü"
        sections={[
          {
            label: "Navigation",
            items: [
              { label: "Main", onClick: onBack },
              { label: "Neues Spiel", onClick: onCreateGame },
              { label: "Statistik", onClick: onOpenStats },
              ...getBattleCalMenuItems()
            ]
          }
        ]}
      />
    }
  >
    <section className="stack">
      <div className="card">
        <h2>Battle-Cal (Vorschau)</h2>
        <p>Der Battle-Calculator wird hier in den Match-Tracker übernommen. Noch keine Daten, noch keine Funktionen.</p>
      </div>
    </section>
  </Layout>
);
