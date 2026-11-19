// A page whose feature ships in a later phase: says plainly what it will do, nothing fake.
export default function ComingNext({ title, lead, points }) {
  return (
    <>
      <div className="ap-top"><div><h1>{title}</h1><p>{lead}</p></div><span className="pill wait">Arriving in the next update</span></div>
      <section className="panel">
        <div className="panel-h"><h2>What you will do here</h2></div>
        <ol className="steps-list">
          {points.map((p, i) => (
            <li key={p}><span className="step-n" aria-hidden="true">{i + 1}</span><div><p style={{ color: "var(--text)" }}>{p}</p></div><span /></li>
          ))}
        </ol>
      </section>
    </>
  );
}
