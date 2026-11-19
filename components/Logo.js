// The Copixio mark: an A drawn as two strokes meeting at a chart peak; the crossbar is a price line that runs past the
// letter and ends in a fill tick (a signal that became an order). See DESIGN.md.
export function Mark({ size = 32, title }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path d="M8 55 L30 9 L52 55" fill="none" stroke="currentColor" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.5 39 H54" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M54 33 V45" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M13 50 L30 15 L47 50" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}

export function Brand({ href = "/", size = 32 }) {
  return (
    <a className="brand" href={href} aria-label="Copixio home">
      <Mark size={size} />
      <b>Copixio</b>
    </a>
  );
}
