export function ScrollArea({ className = '', children, ...props }) {
  return (
    <div className={`ui-scroll ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}
