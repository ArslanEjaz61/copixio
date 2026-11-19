"use client";
import { useState } from "react";

async function post(body) {
  const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  return { ok: !!r && r.ok, ...j, error: j.error || (!r ? "Could not reach Copixio." : undefined) };
}

function Msg({ m }) { return m ? <div className={`note ${m.ok ? "ok" : "bad"}`} role="status">{m.text}</div> : null; }

export default function SettingsClient({ name, email, paused, notifyOn, notifyAvailable }) {
  const [pause, setPause] = useState(paused);
  const [mProfile, setMProfile] = useState(null);
  const [mPw, setMPw] = useState(null);
  const [mPause, setMPause] = useState(null);
  const [mNotify, setMNotify] = useState(null);
  const [nOn, setNOn] = useState(notifyOn);

  return (
    <>
      <section className="panel">
        <div className="panel-h"><h2>Bot</h2><span className={`pill ${pause ? "wait" : "ok"}`}>{pause ? "Paused" : "Running"}</span></div>
        <div className="form-col">
          <p>{pause ? "No new trades are placed. Open trades keep their stop loss and targets." : "The bot trades new signals from the groups you switched on."}</p>
          <Msg m={mPause} />
          <div className="actions"><button className={`btn ${pause ? "btn-ink" : "btn-line"}`} type="button" onClick={async () => {
            const j = await post({ action: "pause", paused: !pause });
            if (j.ok) { setPause(j.paused); setMPause({ ok: true, text: j.paused ? "Paused." : "Running again." }); } else setMPause({ ok: false, text: j.error });
          }}>{pause ? "Start the bot again" : "Pause all trading"}</button></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Telegram notifications</h2>{nOn && <span className="pill ok">On</span>}</div>
        <div className="form-col">
          <p className="hint">Get a Telegram message for every trade the bot opens and closes, and when a signal is skipped.</p>
          {!notifyAvailable ? <p className="hint">Notifications are being set up on our side.</p> : nOn ? (
            <div className="actions"><button className="btn btn-line" type="button" onClick={async () => { const j = await post({ action: "notify-off" }); if (j.ok) setNOn(false); }}>Turn off</button></div>
          ) : (
            <div className="actions"><button className="btn btn-ink" type="button" onClick={async () => {
              const j = await post({ action: "notify-link" });
              if (j.ok) { window.open(j.url, "_blank", "noopener"); setMNotify({ ok: true, text: "Telegram opened. Press Start in the Copixio bot chat, then reload this page." }); }
              else setMNotify({ ok: false, text: j.error });
            }}>Connect notifications</button></div>
          )}
          <Msg m={mNotify} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Profile</h2></div>
        <form className="form-col" onSubmit={async (e) => { e.preventDefault(); const j = await post({ action: "profile", name: new FormData(e.currentTarget).get("name") }); setMProfile(j.ok ? { ok: true, text: "Saved." } : { ok: false, text: j.error }); }}>
          <div className="form-grid">
            <div className="field"><label htmlFor="name">Name</label><input className="input" id="name" name="name" defaultValue={name} maxLength={80} required /></div>
            <div className="field"><label>Email</label><input className="input" value={email} disabled /></div>
          </div>
          <Msg m={mProfile} />
          <div className="actions"><button className="btn btn-ink" type="submit">Save</button></div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Password</h2></div>
        <form className="form-col" onSubmit={async (e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget);
          if (f.get("next") !== f.get("again")) return setMPw({ ok: false, text: "The two new passwords are not the same." });
          const j = await post({ action: "password", current: f.get("current"), next: f.get("next") });
          setMPw(j.ok ? { ok: true, text: "Password changed. Other devices were signed out." } : { ok: false, text: j.error });
          if (j.ok) e.target.reset();
        }}>
          <div className="form-grid">
            <div className="field"><label htmlFor="current">Current password</label><input className="input" id="current" name="current" type="password" autoComplete="current-password" required /></div>
            <div className="field"><label htmlFor="next">New password</label><input className="input" id="next" name="next" type="password" autoComplete="new-password" minLength={10} required /></div>
            <div className="field"><label htmlFor="again">New password again</label><input className="input" id="again" name="again" type="password" autoComplete="new-password" minLength={10} required /></div>
          </div>
          <Msg m={mPw} />
          <div className="actions"><button className="btn btn-ink" type="submit">Change password</button></div>
        </form>
      </section>
    </>
  );
}
