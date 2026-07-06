import { useEffect, useState } from 'react';

// Web surface for the od.publish flag (Decision 15 / publish-contract). Self-
// contained so it can drop into the deploy modal without threading state
// through the surrounding component: it loads GET /api/projects/:id/publish on
// mount and writes PUT on change. The entry defaults to the artifact the deploy
// modal is acting on. Consumed by the Path B website_deploy CI pipeline.
interface PublishToggleProps {
  projectId: string;
  entry: string;
}

interface PublishState {
  enabled: boolean;
  slug: string;
}

function readPublish(value: unknown): PublishState {
  const publish = (value as { publish?: { enabled?: unknown; slug?: unknown } })?.publish;
  return {
    enabled: Boolean(publish?.enabled),
    slug: typeof publish?.slug === 'string' ? publish.slug : '',
  };
}

export function PublishToggle({ projectId, entry }: PublishToggleProps) {
  const [enabled, setEnabled] = useState(false);
  const [slug, setSlug] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/publish`)
      .then((resp) => (resp.ok ? resp.json() : Promise.reject(new Error(String(resp.status)))))
      .then((data) => {
        if (cancelled) return;
        const next = readPublish(data);
        setEnabled(next.enabled);
        setSlug(next.slug);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function persist(nextEnabled: boolean, nextSlug: string) {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { enabled: nextEnabled, entry };
      const trimmed = nextSlug.trim();
      if (trimmed) body.slug = trimmed;
      const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/publish`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(String(resp.status));
      const next = readPublish(await resp.json());
      setEnabled(next.enabled);
      setSlug(next.slug);
    } catch {
      setError('Could not update the publish setting. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="deploy-provider-field publish-toggle">
      <label className="publish-toggle__row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={!loaded || saving}
          onChange={(event) => {
            const next = event.target.checked;
            setEnabled(next);
            void persist(next, slug);
          }}
        />
        <span className="deploy-field-title">Publish to public site</span>
      </label>
      <p className="hint">
        Include this project in the versioned publish pipeline (committed to website_deploy and
        served on Cloudflare Pages). Opt-in — nothing publishes unless checked.
      </p>
      {enabled ? (
        <label className="publish-toggle__slug" style={{ display: 'block', marginTop: 8 }}>
          <span className="deploy-field-title">Public slug</span>
          <input
            type="text"
            value={slug}
            placeholder="my-page"
            disabled={saving}
            onChange={(event) => setSlug(event.target.value)}
            onBlur={() => {
              if (enabled) void persist(true, slug);
            }}
          />
        </label>
      ) : null}
      {saving ? <p className="hint">Saving…</p> : null}
      {error ? (
        <p className="hint" style={{ color: 'var(--danger, #c0392b)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
