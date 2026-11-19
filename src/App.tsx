import type { User } from 'firebase/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppHeader, type NavTabId } from './components/AppHeader';
import { AuthGate } from './components/AuthGate';
import { DashboardView } from './components/DashboardView';
import { FilesSettingsView } from './components/FilesSettingsView';
import { BatchReviewView } from './components/BatchReviewView';
import { ListeningQaView } from './components/ListeningQaView';
import { ProductionView } from './components/ProductionView';
import { SourceRegistryView } from './components/SourceRegistryView';
import { WorkspaceBar } from './components/WorkspaceBar';
import { authedFetch } from './lib/apiClient';
import type { DriveUploadedReceipt } from './lib/driveClient';
import {
  googleSignInOwner,
  initOwnerAuth,
  ownerLogout,
  testFirestoreConnection,
} from './lib/firebaseClient';
import {
  persistJobToFirestore,
  persistMetaToFirestore,
  persistQaToFirestore,
  persistSourceToFirestore,
} from './lib/firestoreSync';
import { VERTEX_VOICE } from './shared/sourceRegistry';
import type {
  AppStateSnapshot,
  AudioJobReceipt,
  ExecutionMode,
  QaRecord,
  QaStatus,
  SourceRow,
  SpeechStyle,
} from './shared/types';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [ownerUser, setOwnerUser] = useState<User | null>(null);
  const [iapAuthenticated, setIapAuthenticated] = useState(false);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTabId>('dashboard');
  const [state, setState] = useState<AppStateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<ExecutionMode>('vertex');
  const [selectedVoice, setSelectedVoice] = useState<string>(VERTEX_VOICE);
  const [selectedSpeechStyle, setSelectedSpeechStyle] = useState<SpeechStyle>('natural');
  const [selectedQaSourceId, setSelectedQaSourceId] = useState<string>('CZ-A0-M01-L01-PH001');
  const [selectedQaStyle, setSelectedQaStyle] = useState<SpeechStyle>('natural');
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

  const fetchState = useCallback(async (isInitialProbe = false): Promise<boolean> => {
    try {
      const res = await authedFetch('/api/state');
      if (res.status === 401 || res.status === 403) {
        const body = await res.json().catch(() => ({}));
        setState(null);
        setIapAuthenticated(false);
        if (!isInitialProbe) {
          setAuthError(
            body.error ?? 'Эзэмшигчийн эрх баталгаажаагүй тул хандалтыг хаалаа.'
          );
        }
        return false;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as AppStateSnapshot;
      setState(data);
      setLoadError(null);
      setAuthError(null);
      if (isInitialProbe) {
        setIapAuthenticated(true);
      }
      if (data.sources.length > 0) {
        setSelectedQaSourceId((prev) =>
          data.sources.some((s) => s.source_id === prev) ? prev : data.sources[0].source_id
        );
      }
      return true;
    } catch (err) {
      if (!isInitialProbe) {
        setLoadError(
          err instanceof Error ? err.message : 'Серверээс мэдээлэл татахад алдаа гарлаа.'
        );
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = initOwnerAuth(
      (user, token) => {
        setOwnerUser(user);
        if (token) setDriveAccessToken(token);
        setAuthReady(true);
        void testFirestoreConnection();
        void fetchState(false);
      },
      () => {
        setOwnerUser(null);
        setDriveAccessToken(null);
        setAuthReady(true);
        // Probe session once in case Cloud Run IAP is protecting this deployment
        void (async () => {
          try {
            const res = await authedFetch('/api/auth/session');
            const session = (await res.json()) as { authenticated?: boolean };
            if (session.authenticated) {
              setIapAuthenticated(true);
              await fetchState(false);
              return;
            }
          } catch {
            // Fall through to unauthenticated AuthGate
          }
          setIapAuthenticated(false);
          setState(null);
          setLoading(false);
        })();
      }
    );
    return unsubscribe;
  }, [fetchState]);

  async function handleOwnerSignIn() {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const { user, driveAccessToken: token } = await googleSignInOwner();
      setOwnerUser(user);
      if (token) setDriveAccessToken(token);
      setLoading(true);
      await testFirestoreConnection();
      const ok = await fetchState(false);
      if (!ok) {
        await ownerLogout();
        setOwnerUser(null);
        setDriveAccessToken(null);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google нэвтрэлт амжилтгүй боллоо.');
    } finally {
      setIsSigningIn(false);
    }
  }

  async function handleConnectDrive(): Promise<string | null> {
    try {
      const { user, driveAccessToken: token } = await googleSignInOwner();
      setOwnerUser(user);
      setDriveAccessToken(token);
      await fetchState(false);
      return token;
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Drive холболт амжилтгүй.');
      return null;
    }
  }

  async function handleLogout() {
    await ownerLogout();
    setOwnerUser(null);
    setIapAuthenticated(false);
    setDriveAccessToken(null);
    setState(null);
    setAuthError(null);
  }

  async function handleRefreshRuntime() {
    setIsRefreshingRuntime(true);
    try {
      await authedFetch('/api/runtime/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      await fetchState(false);
    } finally {
      setIsRefreshingRuntime(false);
    }
  }

  function handlePrimaryAction() {
    setActiveTab('production');
    setConfirmModalOpen(true);
  }

  async function handleRunBatch(ackPrivateTest: boolean, onlyFirstRow = false) {
    if (!state) return;
    setConfirmModalOpen(false);
    setIsBatchRunning(true);
    setIsBatchPaused(false);
    pauseRequestedRef.current = false;

    const baseQueue = state.sources.slice(0, state.runtime.max_first_batch);
    const queue = onlyFirstRow ? baseQueue.slice(0, 1) : baseQueue;

    for (const row of queue) {
      if (pauseRequestedRef.current) {
        setIsBatchPaused(true);
        break;
      }
      setActiveRowId(row.source_id);

      try {
        const res = await authedFetch('/api/tts/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceId: row.source_id,
            voice: selectedVoice,
            speechStyle: selectedSpeechStyle,
            mode,
            acknowledgePrivateTest: ackPrivateTest,
          }),
        });

        const payload = (await res.json().catch(() => null)) as { job?: AudioJobReceipt } | null;
        if (payload?.job && ownerUser) {
          void persistJobToFirestore(payload.job).catch(() => undefined);
        }

        if (res.status === 401 || res.status === 403 || res.status === 409 || res.status === 503) {
          await fetchState(false);
          break;
        }
      } catch {
        // Refresh state to expose error
      }

      await fetchState(false);
    }

    setActiveRowId(null);
    setIsBatchRunning(false);
  }

  async function handleGeneratePh001Variant(style: SpeechStyle) {
    if (!state || isBatchRunning) return;
    setSelectedSpeechStyle(style);
    setIsBatchRunning(true);
    setIsBatchPaused(false);
    setActiveRowId('CZ-A0-M01-L01-PH001');

    try {
      const res = await authedFetch('/api/tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'CZ-A0-M01-L01-PH001',
          voice: selectedVoice,
          speechStyle: style,
          mode,
          acknowledgePrivateTest: true,
        }),
      });
      const payload = (await res.json().catch(() => null)) as { job?: AudioJobReceipt } | null;
      if (payload?.job && ownerUser) {
        void persistJobToFirestore(payload.job).catch(() => undefined);
      }
    } catch {
      // Refresh state to expose error
    } finally {
      await fetchState(false);
      setActiveRowId(null);
      setIsBatchRunning(false);
    }
  }

  function handlePauseBatch() {
    pauseRequestedRef.current = true;
    setIsBatchPaused(true);
  }

  async function handleResetMock() {
    await authedFetch('/api/jobs/reset-mock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    await fetchState(false);
  }

  async function handleSaveQa(
    sourceId: string,
    payload: {
      listening_qa: QaStatus;
      issue_category: string;
      notes: string;
      speechStyle?: SpeechStyle;
      qaKey?: string;
    }
  ) {
    const res = await authedFetch(`/api/qa/${encodeURIComponent(sourceId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error('QA хадгалалт амжилтгүй.');
    }
    const data = (await res.json()) as { qa?: QaRecord };
    if (data.qa && ownerUser) {
      void persistQaToFirestore(data.qa).catch(() => undefined);
    }
    await fetchState(false);
  }

  async function handleImportSuccess(importedRows: SourceRow[]) {
    if (ownerUser) {
      for (const row of importedRows) {
        void persistSourceToFirestore(row).catch(() => undefined);
      }
    }
    await fetchState(false);
  }

  async function handleSelectDriveFolder(folderId: string, folderName: string) {
    const res = await authedFetch('/api/drive/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId, folderName }),
    });
    if (!res.ok) {
      throw new Error('Drive хавтас хадгалж чадсангүй.');
    }
    if (ownerUser && state) {
      void persistMetaToFirestore({
        dataset_version: state.dataset_version,
        drive_folder_id: folderId,
        drive_folder_name: folderName,
      }).catch(() => undefined);
    }
    await fetchState(false);
  }

  async function handleRecordDriveSync(uploadedFiles: DriveUploadedReceipt[]) {
    const res = await authedFetch('/api/drive/sync-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadedFiles }),
    });
    if (!res.ok) {
      throw new Error('Drive синк бүртгэхэд алдаа гарлаа.');
    }
    await fetchState(false);
  }

  if (!authReady || (!ownerUser && !iapAuthenticated && loading)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="w-full max-w-md h-48 rounded-2xl bg-slate-200/70 dark:bg-slate-800/60 animate-pulse" />
      </div>
    );
  }

  if (!ownerUser && !iapAuthenticated) {
    return (
      <AuthGate
        onSignIn={handleOwnerSignIn}
        isSigningIn={isSigningIn}
        error={authError}
      />
    );
  }

  const ownerEmail =
    ownerUser?.email ??
    (iapAuthenticated ? state?.runtime.owner_allowlist[0] ?? 'IAP Owner' : null);

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
          ownerEmail={ownerEmail}
          onLogout={() => void handleLogout()}
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
              onClick={() => void fetchState(false)}
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
                realJobs={state.real_jobs}
                mockJobs={state.mock_jobs}
                mode={mode}
                datasetVersion={state.dataset_version}
                canonicalSha256={state.canonical_curriculum_sha256}
                driveAccessToken={driveAccessToken}
                onConnectDrive={handleConnectDrive}
                onImportSuccess={handleImportSuccess}
              />
            )}

            {activeTab === 'production' && (
              <ProductionView
                sources={state.sources}
                realJobs={state.real_jobs}
                mockJobs={state.mock_jobs}
                qa={state.qa}
                mode={mode}
                runtime={state.runtime}
                selectedVoice={selectedVoice}
                onChangeVoice={setSelectedVoice}
                selectedSpeechStyle={selectedSpeechStyle}
                onChangeSpeechStyle={setSelectedSpeechStyle}
                isBatchRunning={isBatchRunning}
                isBatchPaused={isBatchPaused}
                activeRowId={activeRowId}
                confirmModalOpen={confirmModalOpen}
                onOpenConfirmModal={() => setConfirmModalOpen(true)}
                onCloseConfirmModal={() => setConfirmModalOpen(false)}
                onRunBatch={handleRunBatch}
                onGeneratePh001Variant={handleGeneratePh001Variant}
                onPauseBatch={handlePauseBatch}
                onResetMock={handleResetMock}
                onGoToQa={(id, style) => {
                  setSelectedQaSourceId(id);
                  if (style) setSelectedQaStyle(style);
                  setActiveTab('qa');
                }}
              />
            )}

            {activeTab === 'qa' && (
              <div className="space-y-6">
                <BatchReviewView />
                <ListeningQaView
                sources={state.sources}
                realJobs={state.real_jobs}
                mockJobs={state.mock_jobs}
                mode={mode}
                qa={state.qa}
                selectedSourceId={selectedQaSourceId}
                onSelectSourceId={setSelectedQaSourceId}
                selectedStyle={selectedQaStyle}
                onSelectStyle={setSelectedQaStyle}
                onSaveQa={handleSaveQa}
              />
              </div>
            )}

            {activeTab === 'files' && (
              <FilesSettingsView
                state={state}
                driveAccessToken={driveAccessToken}
                onConnectDrive={handleConnectDrive}
                onSelectDriveFolder={handleSelectDriveFolder}
                onRecordDriveSync={handleRecordDriveSync}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
