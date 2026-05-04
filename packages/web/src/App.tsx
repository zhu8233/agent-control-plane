import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

const api = (path: string, init?: RequestInit) =>
  fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

type TaskRow = { task_id: string; status?: string; title?: string; claimed_by?: string | null };

type Context = {
  ok: true;
  task: Record<string, unknown>;
  claimed_by?: string;
  team_plan: Record<string, unknown> | null;
  assignments: Array<Record<string, unknown>>;
  evidences: Array<Record<string, unknown>>;
  gates: Array<Record<string, unknown>>;
  coordination_events: Array<Record<string, unknown>>;
  handoffs: Array<Record<string, unknown>>;
  escalations: Array<Record<string, unknown>>;
};

export function App() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [gateId, setGateId] = useState('gate-verify-1');
  const [gateKind, setGateKind] = useState('verify_done');
  const [evidenceUri, setEvidenceUri] = useState('https://example.invalid/acp-demo.log');

  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const r = await api('/api/tasks');
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as { tasks: TaskRow[] };
      return j.tasks;
    },
  });

  const ctxQuery = useQuery({
    queryKey: ['context', selected],
    enabled: Boolean(selected),
    queryFn: async () => {
      const r = await api(`/api/tasks/${encodeURIComponent(selected!)}/context`);
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as Context;
    },
  });

  const claimMut = useMutation({
    mutationFn: async (taskId: string) => {
      const r = await api(`/api/tasks/${encodeURIComponent(taskId)}/claim`, {
        method: 'POST',
        body: JSON.stringify({ claimed_by: 'web' }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (_data, taskId) => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['context', taskId] });
    },
  });

  const evidenceMut = useMutation({
    mutationFn: async ({ taskId, uri }: { taskId: string; uri: string }) => {
      const r = await api(`/api/tasks/${encodeURIComponent(taskId)}/evidence`, {
        method: 'POST',
        body: JSON.stringify({ type: 'log', uri }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (_data, { taskId }) => {
      void qc.invalidateQueries({ queryKey: ['context', taskId] });
    },
  });

  const gateMut = useMutation({
    mutationFn: async ({
      taskId,
      gid,
      kind,
    }: {
      taskId: string;
      gid: string;
      kind: string;
    }) => {
      const r = await api(
        `/api/tasks/${encodeURIComponent(taskId)}/gates/${encodeURIComponent(gid)}/result`,
        {
          method: 'POST',
          body: JSON.stringify({ kind, status: 'passed', actor: 'web' }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (_data, { taskId }) => {
      void qc.invalidateQueries({ queryKey: ['context', taskId] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const err = useMemo(() => {
    const lines: string[] = [];
    if (tasksQuery.error) lines.push(String(tasksQuery.error.message));
    if (ctxQuery.error) lines.push(String((ctxQuery.error as Error).message));
    if (claimMut.error) lines.push(`claim: ${(claimMut.error as Error).message}`);
    if (evidenceMut.error) lines.push(`evidence: ${(evidenceMut.error as Error).message}`);
    if (gateMut.error) lines.push(`gate: ${(gateMut.error as Error).message}`);
    return lines.join('\n');
  }, [
    tasksQuery.error,
    ctxQuery.error,
    claimMut.error,
    evidenceMut.error,
    gateMut.error,
  ]);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 1100 }}>
      <h1>Agent Control Plane</h1>
      <p style={{ color: '#444' }}>
        Local console — API proxied via Vite (<code>/api → :3840</code>). Start{' '}
        <code>npm run dev:server</code> then <code>npm run dev:web</code>.
      </p>
      {err ? (
        <pre style={{ background: '#fee', padding: 12, borderRadius: 8 }}>{err}</pre>
      ) : null}

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 24 }}>
        <div>
          <h2>Tasks</h2>
          {tasksQuery.isLoading ? <p>Loading…</p> : null}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {(tasksQuery.data ?? []).map((t) => (
              <li key={t.task_id} style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => setSelected(t.task_id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: 10,
                    borderRadius: 8,
                    border: selected === t.task_id ? '2px solid #246' : '1px solid #ccc',
                    background: selected === t.task_id ? '#e8f4ff' : '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <strong>{t.task_id}</strong>
                  <div style={{ fontSize: 12, color: '#555' }}>
                    {t.status} {t.claimed_by ? `· claimed ${t.claimed_by}` : ''}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2>Detail</h2>
          {!selected ? <p>Select a task.</p> : null}
          {selected && ctxQuery.isLoading ? <p>Loading context…</p> : null}
          {selected && ctxQuery.data ? (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button
                  type="button"
                  disabled={claimMut.isPending}
                  onClick={() => claimMut.mutate(selected)}
                >
                  Claim task
                </button>
                <button
                  type="button"
                  disabled={!selected || evidenceMut.isPending}
                  onClick={() =>
                    selected && evidenceMut.mutate({ taskId: selected, uri: evidenceUri })
                  }
                >
                  Submit evidence
                </button>
                <button
                  type="button"
                  disabled={!selected || gateMut.isPending}
                  onClick={() =>
                    selected && gateMut.mutate({ taskId: selected, gid: gateId, kind: gateKind })
                  }
                >
                  Mark gate passed
                </button>
              </div>
              <label style={{ display: 'block', marginBottom: 8 }}>
                Evidence URI{' '}
                <input
                  value={evidenceUri}
                  onChange={(e) => setEvidenceUri(e.target.value)}
                  style={{ width: '100%' }}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <label>
                  Gate id{' '}
                  <input value={gateId} onChange={(e) => setGateId(e.target.value)} />
                </label>
                <label>
                  Kind{' '}
                  <select value={gateKind} onChange={(e) => setGateKind(e.target.value)}>
                    {(
                      [
                        'plan_ready',
                        'context_ready',
                        'execute_done',
                        'verify_done',
                        'review_done',
                        'archive_done',
                      ] as const
                    ).map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <pre
                style={{
                  background: '#f6f8fa',
                  padding: 12,
                  borderRadius: 8,
                  overflow: 'auto',
                  maxHeight: '70vh',
                }}
              >
                {JSON.stringify(ctxQuery.data, null, 2)}
              </pre>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
