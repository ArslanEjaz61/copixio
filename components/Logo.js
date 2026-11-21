// The Copixio mark: a C drawn as an open ring, with a price line rising out of its opening and ending in an arrow --
// a signal leaving the channel and becoming an order. The ring follows the text colour; the line is always brass.
export function Mark({ size = 32, title }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path d="M45.5 16.5 A21.5 21.5 0 1 0 45.5 47.5" fill="none" stroke="currentColor" strokeWidth="5.6" strokeLinecap="round" />
      <path d="M19 39.5 L27 31.5 L33.5 36.5 L50 20" fill="none" stroke="#C08A2E" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M42 20 H50 V28" fill="none" stroke="#C08A2E" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
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
