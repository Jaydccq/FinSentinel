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
      className="rounded-2xl border border-dashed border-[color:var(--border-strong)] bg-slate-800/20 px-5 py-10 text-center"
    >
      <div className="text-[var(--text-muted)] mx-auto mb-3 flex justify-center">
        {icon}
      </div>
      <p className="text-[var(--text-secondary)] font-medium">{title}</p>
      {description && <p className="text-sm text-[var(--text-muted)] mt-1.5">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </motion.div>
  )
}
