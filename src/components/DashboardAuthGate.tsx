import { createContext, useContext, useEffect, useState, type FormEvent, type PropsWithChildren } from "react";
import {
  DASHBOARD_HOME_URL,
  accessScreenForRole,
  appHashAfterAuth,
  clearCachedDashboardRole,
  dashboardLoginErrorMessage,
  loadDashboardRoleOnce,
  setSessionWriteGate
} from "../utils/dashboardAccess";
import { fetchMyAppRole, getDashboardClient, getDashboardConfigState } from "../lib/dashboardClient";

export type DashboardAuthValue = {
  enabled: boolean;
  canEdit: boolean;
  email: string | null;
  signOut: () => Promise<void>;
};

const legacyValue: DashboardAuthValue = {
  enabled: false,
  canEdit: true,
  email: null,
  signOut: async () => {}
};

const DashboardAuthContext = createContext<DashboardAuthValue>(legacyValue);

export const useDashboardAuth = (): DashboardAuthValue => useContext(DashboardAuthContext);

type Phase = "legacy" | "incomplete" | "checking" | "login" | "no-access" | "error" | "ready";

const Gate = ({ children }: PropsWithChildren) => (
  <div className="auth-gate">
    <div className="auth-gate__card card stack">{children}</div>
  </div>
);

export const DashboardAuthProvider = ({ children }: PropsWithChildren) => {
  const [phase, setPhase] = useState<Phase>(() => {
    const state = getDashboardConfigState();
    if (state === "off") return "legacy";
    if (state === "incomplete") return "incomplete";
    return "checking";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  const adopt = async (userId: string, nextEmail: string) => {
    const role = await loadDashboardRoleOnce(userId, window.sessionStorage, () => fetchMyAppRole(getDashboardClient()));
    const screen = accessScreenForRole(true, role);
    setAccountEmail(nextEmail);
    setCanEdit(screen === "edit");
    setSessionWriteGate(screen === "edit" ? "edit" : "view");
    setPhase(screen === "no-access" ? "no-access" : "ready");
  };

  useEffect(() => {
    if (phase === "legacy" || phase === "incomplete") {
      setSessionWriteGate(phase === "legacy" ? "legacy" : "view");
      return;
    }
    if (phase !== "checking") return;
    const client = getDashboardClient();
    let cancelled = false;
    const { data: subscription } = client.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      clearCachedDashboardRole(window.sessionStorage);
      setSessionWriteGate("view");
      setAccountEmail(null);
      setPhase("login");
    });
    void (async () => {
      try {
        const { data: { session } } = await client.auth.getSession();
        if (cancelled) return;
        const nextHash = appHashAfterAuth(window.location.hash);
        if (nextHash) {
          const url = new URL(window.location.href);
          url.hash = nextHash;
          window.history.replaceState(null, "", url);
        }
        if (!session?.user) {
          setSessionWriteGate("view");
          setPhase("login");
          return;
        }
        await adopt(session.user.id, session.user.email ?? "");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
    // Nur beim Start pruefen. Die Rolle wird nicht erneut abgefragt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    clearCachedDashboardRole(window.sessionStorage);
    setSessionWriteGate("view");
    setAccountEmail(null);
    setPassword("");
    setPhase("login");
    try {
      await getDashboardClient().auth.signOut({ scope: "local" });
    } catch {
      // Lokal ist die Sitzung trotzdem beendet.
    }
  };

  const retry = async () => {
    setPhase("checking");
    try {
      const { data: { session } } = await getDashboardClient().auth.getSession();
      if (!session?.user) {
        setSessionWriteGate("view");
        setPhase("login");
        return;
      }
      await adopt(session.user.id, session.user.email ?? "");
    } catch {
      setPhase("error");
    }
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    const nextEmail = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nextEmail)) {
      setFormError("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }
    if (!password) {
      setFormError("Bitte das Passwort eingeben.");
      return;
    }
    if (busy) return;
    setBusy(true);
    setFormError("");
    try {
      const { error } = await getDashboardClient().auth.signInWithPassword({ email: nextEmail, password });
      if (error) {
        setFormError(dashboardLoginErrorMessage(error));
        setPassword("");
        return;
      }
      const { data: { session } } = await getDashboardClient().auth.getSession();
      setPassword("");
      if (!session?.user) {
        setFormError("Die Anmeldung hat nicht geklappt. Bitte versuchen Sie es erneut.");
        return;
      }
      await adopt(session.user.id, session.user.email ?? nextEmail);
    } catch (error) {
      setPhase("error");
      setFormError(dashboardLoginErrorMessage(error instanceof Error ? error : undefined));
    } finally {
      setBusy(false);
    }
  };

  if (phase === "legacy") {
    return <DashboardAuthContext.Provider value={legacyValue}>{children}</DashboardAuthContext.Provider>;
  }

  if (phase === "checking") {
    return (
      <Gate>
        <p className="muted-copy">Anmeldung wird geprüft …</p>
      </Gate>
    );
  }

  if (phase === "incomplete") {
    return (
      <Gate>
        <h1>Anmeldung nicht konfiguriert</h1>
        <p className="muted-copy">Die Verbindung zur Projektübersicht ist unvollständig eingerichtet.</p>
      </Gate>
    );
  }

  if (phase === "login") {
    return (
      <Gate>
        <h1>Anmelden</h1>
        <p className="muted-copy">Bitte melden Sie sich mit dem Konto der Projektübersicht an.</p>
        <form className="stack" onSubmit={(event) => void submitLogin(event)} noValidate>
          <label className="field">
            <span>E-Mail-Adresse</span>
            <input
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              autoFocus
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Passwort</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {formError ? <p className="muted-copy" role="alert">{formError}</p> : null}
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? "Anmelden …" : "Anmelden"}
          </button>
        </form>
        <p className="muted-copy">Passwort vergessen? Bitte wenden Sie sich an die Administration.</p>
      </Gate>
    );
  }

  if (phase === "no-access") {
    return (
      <Gate>
        <h1>Kein Zugang</h1>
        <p>
          Sie sind als <strong>{accountEmail}</strong> angemeldet. Für den Match-Tracker ist noch kein Zugang freigeschaltet.
        </p>
        <p className="muted-copy">Wenn Sie die App nutzen sollen, wenden Sie sich bitte an die Administration.</p>
        <div className="button-row">
          <a className="primary-button auth-gate__link" href={DASHBOARD_HOME_URL}>Zur Projektübersicht</a>
          <button type="button" className="ghost-button" onClick={() => void signOut()}>Abmelden</button>
        </div>
      </Gate>
    );
  }

  if (phase === "error") {
    return (
      <Gate>
        <h1>Zugang konnte nicht geprüft werden</h1>
        <p className="muted-copy">Die Berechtigung konnte gerade nicht gelesen werden. Bitte versuchen Sie es erneut.</p>
        <div className="button-row">
          <button type="button" className="primary-button" onClick={() => void retry()}>Erneut versuchen</button>
          <button type="button" className="ghost-button" onClick={() => void signOut()}>Abmelden</button>
        </div>
      </Gate>
    );
  }

  return (
    <DashboardAuthContext.Provider value={{ enabled: true, canEdit, email: accountEmail, signOut }}>
      {children}
    </DashboardAuthContext.Provider>
  );
};
