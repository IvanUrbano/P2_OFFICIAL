export default function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      {icon && <i className={`${icon} text-4xl mb-4`} style={{ color: '#CBD5E1' }} />}
      <h3 className="text-sm font-bold mb-1" style={{ color: '#0F2D52' }}>{title}</h3>
      <p className="text-xs text-center max-w-sm" style={{ color: '#94A3B8' }}>{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
