'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Settings as SettingsIcon,
  Key,
  Check,
  AlertCircle,
  Trash2,
  Eye,
  EyeOff,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../hooks/useI18n';
import LanguageToggle from '../components/LanguageToggle';
import { settingsApi, type ApiKeyStatus } from '../api/settings';

const CATEGORY_ORDER = ['Market Data', 'AI', 'Trading', 'News'];

function ApiKeyRow({ keyStatus, onRefresh }: { keyStatus: ApiKeyStatus; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!value.trim()) {
      toast.error('API key value cannot be empty');
      return;
    }
    setSaving(true);
    try {
      await settingsApi.saveApiKey(keyStatus.name, value.trim());
      toast.success(`${keyStatus.label} saved successfully`);
      setValue('');
      setEditing(false);
      onRefresh();
    } catch (err) {
      toast.error(
        `Failed to save ${keyStatus.label}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await settingsApi.testApiKey(keyStatus.name);
      if (result.success) {
        toast.success(result.message || `${keyStatus.label} is working`);
      } else {
        toast.error(result.message || `${keyStatus.label} test failed`);
      }
    } catch (err) {
      toast.error(`Test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove ${keyStatus.label}? This action cannot be undone.`)) return;
    try {
      await settingsApi.deleteApiKey(keyStatus.name);
      toast.success(`${keyStatus.label} removed`);
      onRefresh();
    } catch (err) {
      toast.error(
        `Failed to remove ${keyStatus.label}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setValue('');
    setShowValue(false);
  };

  return (
    <div className="flex flex-col gap-2 py-2.5 border-b border-white/5 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-[var(--text-primary)] font-medium truncate">
              {keyStatus.label}
            </span>
            {keyStatus.configured ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/15 text-green-300 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/5 text-[var(--text-muted)] shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                Not configured
              </span>
            )}
          </div>
          {keyStatus.maskedPreview && !editing && (
            <span className="text-xs text-[var(--text-muted)] font-mono shrink-0">
              {keyStatus.maskedPreview}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!editing && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="btn-ghost px-2 py-1 text-xs"
                title="Edit"
              >
                <Key size={13} />
                Edit
              </button>
              {keyStatus.configured && (
                <>
                  <button
                    onClick={handleTest}
                    disabled={testing}
                    className="btn-ghost px-2 py-1 text-xs"
                    title="Test connection"
                  >
                    {testing ? (
                      <RefreshCw size={13} className="animate-spin" />
                    ) : (
                      <Check size={13} />
                    )}
                    Test
                  </button>
                  <button
                    onClick={handleDelete}
                    className="btn-ghost px-2 py-1 text-xs text-red-400 hover:text-red-300"
                    title="Remove key"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {editing && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showValue ? 'text' : 'password'}
              className="field-input w-full pr-8 text-sm"
              placeholder={`Enter ${keyStatus.label} key...`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowValue((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              {showValue ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={handleCancel} className="btn-ghost px-3 py-1.5 text-xs">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [apiKeys, setApiKeys] = useState<ApiKeyStatus[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(true);

  const fetchApiKeys = useCallback(async () => {
    try {
      const keys = await settingsApi.listApiKeys();
      setApiKeys(keys);
    } catch (err) {
      toast.error(
        `Failed to load API keys: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    } finally {
      setApiKeysLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  const keysByCategory = CATEGORY_ORDER.reduce<Record<string, ApiKeyStatus[]>>((acc, cat) => {
    acc[cat] = apiKeys.filter((k) => k.category === cat);
    return acc;
  }, {});

  return (
    <div className="px-4 py-4 md:px-6 md:py-4 space-y-4">
      <section className="glass-panel rounded p-3 md:p-4">
        <div className="flex items-center gap-3 mb-1">
          <SettingsIcon size={18} className="text-blue-400" />
          <h1 className="page-title">{t('settings.title')}</h1>
        </div>
        <p className="page-subtitle">{t('settings.subtitle')}</p>
      </section>

      <section className="glass-panel rounded p-3 md:p-4 space-y-3">
        <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          {t('settings.language')}
        </h2>
        <p className="text-xs text-[var(--text-muted)]">{t('settings.languageDesc')}</p>
        <LanguageToggle />
      </section>

      <section className="glass-panel rounded p-3 md:p-4 space-y-3">
        <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          {t('settings.account')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-[var(--text-muted)] mb-1">{t('settings.username')}</p>
            <p className="text-sm text-[var(--text-primary)] font-medium">
              {user?.username ?? '-'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)] mb-1">{t('settings.email')}</p>
            <p className="text-sm text-[var(--text-primary)] font-medium">{user?.email ?? '-'}</p>
          </div>
        </div>
      </section>

      {/* API Keys Management */}
      <section className="glass-panel rounded p-3 md:p-4 space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Key size={14} className="text-blue-400" />
            <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              API Keys
            </h2>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Manage API keys for market data, AI models, trading, and news integrations.
          </p>
        </div>

        {apiKeysLoading ? (
          <div className="flex items-center justify-center py-6">
            <RefreshCw size={16} className="animate-spin text-[var(--text-muted)]" />
            <span className="ml-2 text-xs text-[var(--text-muted)]">Loading API keys...</span>
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="flex items-center justify-center py-6 gap-2">
            <AlertCircle size={14} className="text-[var(--text-muted)]" />
            <span className="text-xs text-[var(--text-muted)]">
              No API keys available. Check backend configuration.
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            {CATEGORY_ORDER.map((category) => {
              const keys = keysByCategory[category];
              if (!keys || keys.length === 0) return null;
              return (
                <div key={category}>
                  <h3 className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                    {category}
                  </h3>
                  <div className="rounded border border-white/5 bg-white/[0.02] px-3">
                    {keys.map((keyStatus) => (
                      <ApiKeyRow
                        key={keyStatus.name}
                        keyStatus={keyStatus}
                        onRefresh={fetchApiKeys}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/*
        F-6: the Settings-side watchlist editor was a localStorage-only
        duplicate of the server-synced Dashboard watchlist. Collapsed into
        a pointer so there's a single write path and users don't get
        confused by two lists that can drift apart. The full drawer UX
        with thesis/notes/priority editing lives on the Dashboard side;
        see WatchlistController (PATCH/DELETE endpoints) and
        watchlistApi.updateItem / updateCategory for the wire format.
      */}
      <section className="glass-panel rounded p-3 md:p-4 space-y-2">
        <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          {t('settings.watchlist')}
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          {t('settings.watchlistMovedToDashboard')}
        </p>
        <a
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-blue-300 hover:text-blue-200 underline-offset-2 hover:underline"
        >
          {t('settings.goToDashboard')} →
        </a>
      </section>
    </div>
  );
}
