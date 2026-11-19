// Small line icons used on the landing page (24px grid, currentColor).
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

export const Lock = ({ s = 20 }) => (<svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" {...P} /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" {...P} /></svg>);
export const NoWithdraw = ({ s = 20 }) => (<svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" {...P} /><path d="M6 18 18 6" {...P} /></svg>);
export const Sliders = ({ s = 20 }) => (<svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" {...P} /><circle cx="16" cy="7" r="2" {...P} /><circle cx="10" cy="17" r="2" {...P} /></svg>);
export const Check = ({ s = 20 }) => (<svg width={s} height={s} viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5 8.2 14.5 16 6" {...P} strokeWidth="2.2" /></svg>);
export const Pause = ({ s = 24 }) => (<svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" {...P} /><rect x="14" y="5" width="4" height="14" rx="1" {...P} /></svg>);
export const Eye = ({ s = 24 }) => (<svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" {...P} /><circle cx="12" cy="12" r="3" {...P} /></svg>);
export const Server = ({ s = 24 }) => (<svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" {...P} /><path d="M8 20h8M12 16v4" {...P} /></svg>);
export const Menu = ({ s = 26 }) => (<svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" {...P} strokeWidth="2" /></svg>);
