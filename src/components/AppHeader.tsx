import {
  FileSpreadsheet,
  FolderCog,
  Headphones,
  LayoutDashboard,
  Moon,
  Play,
  Sun,
} from 'lucide-react';

export type NavTabId = 'dashboard' | 'sources' | 'production' | 'qa' | 'files';

interface AppHeaderProps {
  activeTab: NavTabId;
  onSelectTab: (tab: NavTabId) => void;
  onPrimaryAction: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

const NAV_ITEMS: Array<{
  id: NavTabId;
  label: string;
  mobileLabel: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', label: 'Хянах самбар', mobileLabel: 'Самбар', icon: LayoutDashboard },
  { id: 'sources', label: 'Өгүүлбэрүүд', mobileLabel: 'Өгүүлбэр', icon: FileSpreadsheet },
  { id: 'production', label: 'Үйлдвэрлэл', mobileLabel: 'Үйлдвэр', icon: Play },
  { id: 'qa', label: 'Сонсож шалгах', mobileLabel: 'Шалгах', icon: Headphones },
  { id: 'files', label: 'Файлууд / Тохиргоо', mobileLabel: 'Тохиргоо', icon: FolderCog },
];

export function AppHeader({
  activeTab,
  onSelectTab,
  onPrimaryAction,
  isDark,
  onToggleTheme,
}: AppHeaderProps) {
  return (
    <>
      {/* Desktop Top Bar: strict 3-zone contract (Wordmark — 5 nav links — 1 primary CTA) */}
      <header className="hidden md:block sticky top-0 z-30 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => onSelectTab('dashboard')}
            className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded"
          >
            Ahoj Česko — Audio Factory
          </button>

          <nav aria-label="Үндсэн цэс" className="flex items-center gap-6 overflow-x-auto">
            {NAV_ITEMS.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`py-2 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                    active
                      ? 'border-sky-600 text-slate-900 dark:text-slate-50'
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={onPrimaryAction}
              className="px-4 py-2 min-h-[40px] text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
            >
              5 аудио үүсгэх
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Compact Top Bar (48px height, within 15% aggregate sticky cap) */}
      <header className="md:hidden sticky top-0 z-30 h-12 px-4 flex items-center justify-between bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => onSelectTab('dashboard')}
          className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-50 truncate cursor-pointer"
        >
          Ahoj Česko — Audio Factory
        </button>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={isDark ? 'Гэрэлтэй горим руу шилжих' : 'Харанхуй горим руу шилжих'}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 dark:text-slate-300"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      {/* Mobile Fixed Bottom Tab Bar (56px height, 48 + 56 = 104px < 15% of 844px) */}
      <nav
        aria-label="Гар утасны цэс"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 items-center"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 px-1 transition-colors ${
                active
                  ? 'text-sky-700 dark:text-sky-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span className="text-[10px] leading-tight whitespace-nowrap truncate max-w-full">
                {item.mobileLabel}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
