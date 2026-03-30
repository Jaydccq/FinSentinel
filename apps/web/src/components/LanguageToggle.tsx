import { Languages } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'

interface LanguageToggleProps {
  compact?: boolean
}

export default function LanguageToggle({ compact = false }: LanguageToggleProps) {
  const { locale, setLocale, t } = useI18n()

  return (
    <div className="inline-flex items-center gap-1.5" aria-label={t('common.language')}>
      {!compact && <Languages size={13} className="text-[var(--text-muted)]" aria-hidden="true" />}
      <div className="inline-flex rounded border border-[color:var(--border-subtle)] overflow-hidden">
        <button
          type="button"
          onClick={() => setLocale('en')}
          className={`px-2 py-1 text-xs transition-colors ${locale === 'en' ? 'bg-blue-500/15 text-blue-200' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'}`}
          aria-pressed={locale === 'en'}
        >
          EN
        </button>
        <button
          type="button"
          onClick={() => setLocale('zh')}
          className={`px-2 py-1 text-xs border-l border-[color:var(--border-subtle)] transition-colors ${locale === 'zh' ? 'bg-blue-500/15 text-blue-200' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'}`}
          aria-pressed={locale === 'zh'}
        >
          中文
        </button>
      </div>
    </div>
  )
}
