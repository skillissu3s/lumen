// The two building blocks of every settings page.

// a group of settings under a small heading, the way obi lays them out
export function Section({ title, description, children }) {
  return (
    <section className="set-section">
      {title && <h3>{title}</h3>}
      {description && <p className="setting-desc set-section-desc">{description}</p>}
      <div className="set-section-body">{children}</div>
    </section>
  )
}

// one setting: its name (and a line about it) on the left, the control on the right
export function Row({ label, hint, children, stacked }) {
  return (
    <div className={`setting${stacked ? ' stacked' : ''}`}>
      <div className="setting-text">
        <div className="setting-name">{label}</div>
        {hint && <div className="setting-desc">{hint}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}
