// Mobile components removed - Agregarr is desktop-focused
// SearchInput removed - no discovery functionality needed
import Sidebar from '@app/components/Layout/Sidebar';
import UserDropdown from '@app/components/Layout/UserDropdown';
import type { AvailableLocale } from '@app/context/LanguageContext';
import useFirstTimeSetup from '@app/hooks/useFirstTimeSetup';
import useLocale from '@app/hooks/useLocale';
import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';

type LayoutProps = {
  children: React.ReactNode;
};

const Layout = ({ children }: LayoutProps) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { user } = useUser();
  const { currentSettings } = useSettings();
  const { setLocale } = useLocale();
  const { isFirstTimeSetup } = useFirstTimeSetup();
  // Request and issue counting removed - not needed in Agregarr

  useEffect(() => {
    if (setLocale && user) {
      setLocale(
        (user?.settings?.locale
          ? user.settings.locale
          : currentSettings.locale) as AvailableLocale
      );
    }
  }, [setLocale, currentSettings.locale, user]);

  return (
    <div className="flex h-full min-h-full min-w-0 bg-stone-900">
      <div className="pwa-only fixed inset-0 z-20 h-1 w-full border-stone-700 md:border-t" />
      <div className="absolute top-0 h-64 w-full bg-gradient-to-bl from-stone-800 to-stone-900">
        <div className="relative inset-0 h-full w-full bg-gradient-to-t from-stone-900 to-transparent" />
      </div>
      <Sidebar
        open={isSidebarOpen}
        setClosed={() => setIsSidebarOpen(false)}
        pendingRequestsCount={0}
        openIssuesCount={0}
        revalidateIssueCount={() => undefined}
        revalidateRequestsCount={() => undefined}
        isFirstTimeSetup={isFirstTimeSetup}
      />

      {/* Hamburger menu button for smaller screens */}
      <div className="lg:hidden">
        <button
          className="fixed top-4 left-4 z-50 rounded-md bg-stone-800 p-2 text-white shadow-sm hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
          onClick={() => setIsSidebarOpen(true)}
          aria-label="Open menu"
        >
          <Bars3Icon className="h-6 w-6" />
        </button>
      </div>

      <div className="relative flex w-0 min-w-0 flex-1 flex-col lg:ml-64">
        {/* UserDropdown at top of page content - scrolls with page */}
        <div className="flex items-center justify-end p-2 lg:p-4">
          <UserDropdown />
        </div>

        <main className="relative z-0 focus:outline-none" tabIndex={0}>
          <div className="mb-6">
            <div className="max-w-8xl mx-auto px-4">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
