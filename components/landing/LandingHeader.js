"use client";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Logo";
import { Menu } from "./Icons";

const LINKS = [["#how", "How it works"], ["#rules", "Your rules"], ["#security", "Security"], ["#pricing", "Pricing"], ["#faq", "FAQ"]];

// Transparent over the ink hero, solid paper once the hero has scrolled away.
export default function LandingHeader() {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const hero = document.getElementById("hero");
    const f = () => setSolid(window.scrollY > (hero ? hero.offsetHeight - 80 : 400));
    f();
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);
  return (
    <>
      <header className={`lp-hdr${solid || open ? " solid" : ""}`}>
        <div className="in">
          <Brand href="#top" />
          <nav className="lp-nav" aria-label="Main">
            {LINKS.map(([h, t]) => <a key={h} href={h}>{t}</a>)}
          </nav>
          <div className="lp-act">
            <a className="lp-signin" href="/login">Sign in</a>
            <a className="btn btn-cta" href="/signup">Create account</a>
            <button className="lp-menu" type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="lp-drawer" onClick={() => setOpen((o) => !o)}>
              <Menu />
            </button>
          </div>
        </div>
      </header>
      {open && (
        <div className="lp-drawer" id="lp-drawer" onClick={(e) => { if (e.target.tagName === "A") setOpen(false); }}>
          <div className="in">
            {LINKS.map(([h, t]) => <a key={h} href={h}>{t}</a>)}
            <a href="/login">Sign in</a>
            <a className="btn btn-cta" href="/signup">Create account</a>
          </div>
        </div>
      )}
    </>
  );
}
