export function EmptyState({ icon: Icon, title, children, action, className = '', ...props }) {
  return (
    <div className={`ui-empty ${className}`.trim()} {...props}>
      {Icon ? (
        <span className="ui-empty-icon">
          <Icon size={24} strokeWidth={1.75} aria-hidden="true" />
        </span>
      ) : null}
      {title ? <div className="ui-empty-title">{title}</div> : null}
      {children ? <div className="ui-empty-body">{children}</div> : null}
      {action ? <div className="ui-empty-action">{action}</div> : null}
    </div>
  )
}
