import { useCallback, useEffect, useRef, useState } from 'react';
import { AppHeader, type NavTabId } from './components/AppHeader';
import { DashboardView } from './components/DashboardView';
import { FilesSettingsView } from './components/FilesSettingsView';
import { ListeningQaView } from './components/ListeningQaView';
import { ProductionView } from './components/ProductionView';
import { SourceRegistryView } from './components/SourceRegistryView';
import { WorkspaceBar } from './components/WorkspaceBar';
import { VERTEX_VOICE } from './shared/sourceRegistry';
import type { AppStateSnapshot, ExecutionMode, QaStatus } from './shared/types';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTabId>('dashboard');
  const [state, setState] = useState<AppStateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<ExecutionMode>('vertex');
  const [selectedVoice, setSelectedVoice] = useState<string>(VERTEX_VOICE);
  const [selectedQaSourceId, setSelectedQaSourceId] = useState<string>('CZ-A0-M01-L01-PH001');
  const [isDark, setIsDark] = useState<boolean>(false);
  const [isRefreshingRuntime, setIsRefreshingRuntime] = useState<boolean>(false);

  // Batch runner state
  const [confirmModalOpen, setConfirmModalOpen] = useState<boolean>(false);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [isBatchPaused, setIsBatchPaused] = useState<boolean>(false);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const pauseRequestedRef = useRef<boolean>(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [activeTab]);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state', {
        headers: { 'X-Requested-With': 'AhojAudioFactory' },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as AppStateSnapshot;
      setState(data);
      setLoadError(null);
      if (data.sources.length > 0) {
        setSelectedQaSourceId((prev) =>
          data.sources.some((s) => s.source_id === prev) ? prev : data.sources[0].source_id
        );
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Серверээс мэдээлэл татахад алдаа гарлаа.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  async function handleRefreshRuntime() {
    setIsRefreshingRuntime(true);
    try {
      await fetch('/api/runtime/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'AhojAudioFactory',
        },
      });
      await fetchState();
    } finally {
      setIsRefreshingRuntime(false);
    }
  }

  function handlePrimaryAction() {
    setActiveTab('production');
    setConfirmModalOpen(true);
  }

  async function handleRunBatch(ackPrivateTest: boolean) {
    if (!state) return;
    setConfirmModalOpen(false);
    setIsBatchRunning(true);
    setIsBatchPaused(false);
    pauseRequestedRef.current = false;

    const queue = state.sources.slice(0, state.runtime.max_first_batch);
    for (const row of queue) {
      if (pauseRequestedRef.current) {
        setIsBatchPaused(true);
        break;
      }
      setActiveRowId(row.source_id);

      try {
        const res = await fetch('/api/tts/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'AhojAudioFactory',
          },
          body: JSON.stringify({
            sourceId: row.source_id,
            voice: selectedVoice,
            speedProfile: 'normal',
            mode,
            acknowledgePrivateTest: ackPrivateTest,
          }),
        });

        // Stop batch immediately on 401/403 or missing Vertex ADC
        if (res.status === 401 || res.status === 403 || res.status === 503) {
          await fetchState();
          break;
        }
      } catch {
        // Continue refreshing state so failure is visible
      }

      await fetchState();
    }

    setActiveRowId(null);
    setIsBatchRunning(false);
  }

  function handlePauseBatch() {
    pauseRequestedRef.current = true;
    setIsBatchPaused(true);
  }

  async function handleResetMock() {
    await fetch('/api/jobs/reset-mock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'AhojAudioFactory',
      },
    });
    await fetchState();
  }

  async function handleSaveQa(
    sourceId: string,
    payload: { listening_qa: QaStatus; issue_category: string; notes: string }
  ) {
    const res = await fetch(`/api/qa/${encodeURIComponent(sourceId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'AhojAudioFactory',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error('QA хадгалалт амжилтгүй.');
    }
    await fetchState();
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-20 md:pb-10">
      <AppHeader
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onPrimaryAction={handlePrimaryAction}
        isDark={isDark}
        onToggleTheme={() => setIsDark((d) => !d)}
      />

      {state && (
        <WorkspaceBar
          mode={mode}
          onChangeMode={setMode}
          runtime={state.runtime}
          isDark={isDark}
          onToggleTheme={() => setIsDark((d) => !d)}
          onRefreshRuntime={handleRefreshRuntime}
          isRefreshing={isRefreshingRuntime}
        />
      )}

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
        {loading && (
          <div className="space-y-4" aria-busy="true" aria-label="Ачааллаж байна">
            <div className="h-40 rounded-2xl bg-slate-200/70 dark:bg-slate-800/60 animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="h-28 rounded-xl bg-slate-200/70 dark:bg-slate-800/60 animate-pulse" />
              <div className="h-28 rounded-xl bg-slate-200/70 dark:bg-slate-800/60 animate-pulse" />
              <div className="h-28 rounded-xl bg-slate-200/70 dark:bg-slate-800/60 animate-pulse" />
              <div className="h-28 rounded-xl bg-slate-200/70 dark:bg-slate-800/60 animate-pulse" />
            </div>
          </div>
        )}

        {!loading && loadError && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-2xl p-6 space-y-3">
            <p className="text-base font-bold text-red-900 dark:text-red-200">
              Сервертэй холбогдож чадсангүй
            </p>
            <p className="text-sm text-red-800 dark:text-red-300">{loadError}</p>
            <button
              type="button"
              onClick={() => void fetchState()}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-red-700 text-white text-sm font-semibold cursor-pointer"
            >
              Дахин оролдох
            </button>
          </div>
        )}

        {!loading && !loadError && state && (
          <>
            {activeTab === 'dashboard' && (
              <DashboardView
                state={state}
                mode={mode}
                onStartFirstFive={handlePrimaryAction}
                onNavigate={setActiveTab}
                onSwitchToMock={() => setMode('mock')}
              />
            )}

            {activeTab === 'sources' && (
              <SourceRegistryView
                sources={state.sources}
                jobs={state.jobs}
                datasetVersion={state.dataset_version}
                canonicalSha256={state.canonical_curriculum_sha256}
                onImportSuccess={fetchState}
              />
            )}

            {activeTab === 'production' && (
              <ProductionView
                sources={state.sources}
                jobs={state.jobs}
                mode={mode}
                runtime={state.runtime}
                selectedVoice={selectedVoice}
                onChangeVoice={setSelectedVoice}
                isBatchRunning={isBatchRunning}
                isBatchPaused={isBatchPaused}
                activeRowId={activeRowId}
                confirmModalOpen={confirmModalOpen}
                onOpenConfirmModal={() => setConfirmModalOpen(true)}
                onCloseConfirmModal={() => setConfirmModalOpen(false)}
                onRunBatch={handleRunBatch}
                onPauseBatch={handlePauseBatch}
                onResetMock={handleResetMock}
                onGoToQa={(id) => {
                  setSelectedQaSourceId(id);
                  setActiveTab('qa');
                }}
              />
            )}

            {activeTab === 'qa' && (
              <ListeningQaView
                sources={state.sources}
                jobs={state.jobs}
                qa={state.qa}
                selectedSourceId={selectedQaSourceId}
                onSelectSourceId={setSelectedQaSourceId}
                onSaveQa={handleSaveQa}
              />
            )}

            {activeTab === 'files' && <FilesSettingsView state={state} />}
          </>
        )}
      </main>
    </div>
  );
}
