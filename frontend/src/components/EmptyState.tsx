import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded border border-dashed border-[var(--border-strong)] bg-[var(--bg-panel)] px-5 py-8 text-center"
    >
      <div className="text-[var(--text-muted)] mx-auto mb-3 flex justify-center">
        {icon}
      </div>
      <p className="text-[var(--text-secondary)] font-medium text-sm">{title}</p>
      {description && <p className="text-xs text-[var(--text-muted)] mt-1">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </motion.div>
  )
}
