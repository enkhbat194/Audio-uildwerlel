import { FlaskConical, LogOut, Moon, RefreshCw, ShieldAlert, ShieldCheck, Sun } from 'lucide-react';
import type { CloudRuntimeStatus, ExecutionMode } from '../shared/types';

interface WorkspaceBarProps {
  mode: ExecutionMode;
  onChangeMode: (mode: ExecutionMode) => void;
  runtime: CloudRuntimeStatus;
  ownerEmail: string | null;
  onLogout: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  onRefreshRuntime: () => void;
  isRefreshing: boolean;
}

export function WorkspaceBar({
  mode,
  onChangeMode,
  runtime,
  ownerEmail,
  onLogout,
  isDark,
  onToggleTheme,
  onRefreshRuntime,
  isRefreshing,
}: WorkspaceBarProps) {
  return (
    <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/60">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div
            role="group"
            aria-label="Ажиллах горим"
            className="inline-flex items-center p-1 bg-slate-200/80 dark:bg-slate-800 rounded-lg"
          >
            <button
              type="button"
              onClick={() => onChangeMode('vertex')}
              className={`px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 ${
                mode === 'vertex'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {runtime.vertex_connected ? (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              )}
              <span>Бодит Vertex AI</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeMode('mock')}
              className={`px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 ${
                mode === 'mock'
                  ? 'bg-white dark:bg-slate-950 text-amber-800 dark:text-amber-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Тестийн горим (MOCK)</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {runtime.vertex_connected ? 'Vertex AI: ХОЛБОГДСОН' : 'Vertex AI: ТОХИРУУЛААГҮЙ'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{runtime.model}</span>
            <span aria-hidden="true">·</span>
            <span>{runtime.voice}</span>
            {ownerEmail && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">{ownerEmail}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefreshRuntime}
            disabled={isRefreshing}
            className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Шалгах</span>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            className="hidden md:inline-flex min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-lg transition-colors items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isDark ? <Sun className="w-3.5 h-3.5" aria-hidden="true" /> : <Moon className="w-3.5 h-3.5" aria-hidden="true" />}
            <span>{isDark ? 'Гэрэлтэй' : 'Харанхуй'}</span>
          </button>

          {ownerEmail && (
            <button
              type="button"
              onClick={onLogout}
              className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Гарах</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
