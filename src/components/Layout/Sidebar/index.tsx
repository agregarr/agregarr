import VersionStatus from '@app/components/Layout/VersionStatus';
import useClickOutside from '@app/hooks/useClickOutside';
import type { Permission } from '@app/hooks/useUser';
import { useUser } from '@app/hooks/useUser';
import { Transition } from '@headlessui/react';
import {
  ChartBarIcon,
  CogIcon,
  HomeIcon,
  QueueListIcon,
  RectangleStackIcon,
  StarIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Fragment, useRef } from 'react';
import { defineMessages, useIntl } from 'react-intl';

export const menuMessages = defineMessages({
  dashboard: 'Dashboard',
  home: 'Home',
  recommended: 'Recommended',
  library: 'Library',
  allcollections: 'All Collections',
  settings: 'Settings',
});

interface SidebarProps {
  open?: boolean;
  setClosed: () => void;
  pendingRequestsCount: number;
  openIssuesCount: number;
  revalidateIssueCount: () => void;
  revalidateRequestsCount: () => void;
  isFirstTimeSetup?: boolean;
}

interface SidebarLinkProps {
  href: string;
  svgIcon: React.ReactNode;
  messagesKey: keyof typeof menuMessages;
  activeRegExp: RegExp;
  as?: string;
  requiredPermission?: Permission | Permission[];
  permissionType?: 'and' | 'or';
  dataTestId?: string;
}

const SidebarLinks: SidebarLinkProps[] = [
  {
    href: '/dashboard',
    messagesKey: 'dashboard',
    svgIcon: <ChartBarIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/dashboard$/,
    dataTestId: 'sidebar-menu-dashboard',
  },
  {
    href: '/',
    messagesKey: 'home',
    svgIcon: <HomeIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/$/,
    dataTestId: 'sidebar-menu-home',
  },
  {
    href: '/recommended',
    messagesKey: 'recommended',
    svgIcon: <StarIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/recommended$/,
    dataTestId: 'sidebar-menu-recommended',
  },
  {
    href: '/library',
    messagesKey: 'library',
    svgIcon: <RectangleStackIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/library/,
    dataTestId: 'sidebar-menu-library',
  },
  {
    href: '/allcollections',
    messagesKey: 'allcollections',
    svgIcon: <QueueListIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/allcollections$/,
    dataTestId: 'sidebar-menu-allcollections',
  },
  {
    href: '/settings',
    messagesKey: 'settings',
    svgIcon: <CogIcon className="mr-3 h-6 w-6" />,
    activeRegExp: /^\/settings/,
    dataTestId: 'sidebar-menu-settings',
  },
];

const Sidebar = ({
  open,
  setClosed,
  isFirstTimeSetup = false,
}: SidebarProps) => {
  const navRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const intl = useIntl();
  useUser(); // hasPermission removed - not used in simplified sidebar
  useClickOutside(navRef, () => setClosed());

  return (
    <>
      <div className="lg:hidden">
        <Transition as={Fragment} show={open}>
          <div className="fixed inset-0 z-40 flex">
            <Transition.Child
              as="div"
              enter="transition-opacity ease-linear duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="transition-opacity ease-linear duration-300"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0">
                <div className="absolute inset-0 bg-stone-900 opacity-90"></div>
              </div>
            </Transition.Child>
            <Transition.Child
              as="div"
              enter="transition-transform ease-in-out duration-300"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transition-transform ease-in-out duration-300"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <>
                <div className="sidebar relative flex h-full w-full max-w-xs flex-1 flex-col bg-stone-800">
                  <div className="sidebar-close-button absolute right-0 -mr-14 p-1">
                    <button
                      className="flex h-12 w-12 items-center justify-center rounded-full focus:bg-stone-600 focus:outline-none"
                      aria-label="Close sidebar"
                      onClick={() => setClosed()}
                    >
                      <XMarkIcon className="h-6 w-6 text-white" />
                    </button>
                  </div>
                  <div
                    ref={navRef}
                    className="flex flex-1 flex-col overflow-y-auto pt-8 pb-8 sm:pb-4"
                  >
                    <div className="flex flex-shrink-0 items-center px-2">
                      <span className="px-4 text-xl text-gray-50">
                        <a href="/">
                          <img src="/logo_full.svg" alt="Logo" />
                        </a>
                      </span>
                    </div>
                    <nav className="mt-16 flex-1 space-y-4 px-4">
                      {SidebarLinks.map((sidebarLink) => {
                        return (
                          <Link
                            key={`mobile-${sidebarLink.messagesKey}`}
                            href={sidebarLink.href}
                            as={sidebarLink.as}
                          >
                            <a
                              onClick={() =>
                                isFirstTimeSetup &&
                                sidebarLink.messagesKey !== 'settings'
                                  ? undefined
                                  : setClosed()
                              }
                              onKeyDown={(e) => {
                                if (
                                  e.key === 'Enter' &&
                                  !(
                                    isFirstTimeSetup &&
                                    sidebarLink.messagesKey !== 'settings'
                                  )
                                ) {
                                  setClosed();
                                }
                              }}
                              role="button"
                              tabIndex={
                                isFirstTimeSetup &&
                                sidebarLink.messagesKey !== 'settings'
                                  ? -1
                                  : 0
                              }
                              className={`flex items-center rounded-md px-2 py-2 text-base font-medium leading-6 transition duration-150 ease-in-out focus:outline-none ${
                                isFirstTimeSetup &&
                                sidebarLink.messagesKey !== 'settings'
                                  ? 'pointer-events-none cursor-not-allowed text-gray-600 opacity-50'
                                  : isFirstTimeSetup &&
                                    sidebarLink.messagesKey === 'settings'
                                  ? 'text-gray-400 opacity-60 hover:bg-stone-700 focus:bg-stone-700'
                                  : router.pathname.match(
                                      sidebarLink.activeRegExp
                                    )
                                  ? 'bg-gradient-to-br from-orange-500 to-orange-500 text-white hover:from-orange-400 hover:to-orange-400'
                                  : 'text-white hover:bg-stone-700 focus:bg-stone-700'
                              }`}
                              data-testid={`${sidebarLink.dataTestId}-mobile`}
                            >
                              {sidebarLink.svgIcon}
                              {intl.formatMessage(
                                menuMessages[sidebarLink.messagesKey]
                              )}
                            </a>
                          </Link>
                        );
                      })}
                    </nav>
                    <div className="px-2">
                      <VersionStatus
                        onClick={() => setClosed()}
                        isFirstTimeSetup={isFirstTimeSetup}
                      />
                    </div>
                  </div>
                </div>
                <div className="w-14 flex-shrink-0">
                  {/* <!-- Force sidebar to shrink to fit close icon --> */}
                </div>
              </>
            </Transition.Child>
          </div>
        </Transition>
      </div>

      <div className="fixed top-0 bottom-0 left-0 z-30 hidden lg:flex lg:flex-shrink-0">
        <div className="sidebar flex w-64 flex-col">
          <div className="flex h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col overflow-y-auto pt-8 pb-4">
              <div className="flex flex-shrink-0 items-center">
                <span className="px-4 text-2xl text-gray-50">
                  <a href="/">
                    <img src="/logo_full.svg" alt="Logo" />
                  </a>
                </span>
              </div>
              <nav className="mt-16 flex-1 space-y-4 px-4">
                {SidebarLinks.map((sidebarLink) => {
                  return (
                    <Link
                      key={`desktop-${sidebarLink.messagesKey}`}
                      href={sidebarLink.href}
                      as={sidebarLink.as}
                    >
                      <a
                        tabIndex={
                          isFirstTimeSetup &&
                          sidebarLink.messagesKey !== 'settings'
                            ? -1
                            : 0
                        }
                        className={`group flex items-center rounded-md px-2 py-2 text-lg font-medium leading-6 transition duration-150 ease-in-out focus:outline-none ${
                          isFirstTimeSetup &&
                          sidebarLink.messagesKey !== 'settings'
                            ? 'pointer-events-none cursor-not-allowed text-gray-600 opacity-50'
                            : isFirstTimeSetup &&
                              sidebarLink.messagesKey === 'settings'
                            ? 'text-gray-400 opacity-60 hover:bg-stone-700 focus:bg-stone-700'
                            : router.pathname.match(sidebarLink.activeRegExp)
                            ? 'bg-gradient-to-br from-orange-500 to-orange-500 text-white hover:from-orange-400 hover:to-orange-400'
                            : 'text-white hover:bg-stone-700 focus:bg-stone-700'
                        }`}
                        data-testid={sidebarLink.dataTestId}
                      >
                        {sidebarLink.svgIcon}
                        {intl.formatMessage(
                          menuMessages[sidebarLink.messagesKey]
                        )}
                      </a>
                    </Link>
                  );
                })}
              </nav>
              <div className="px-2">
                <VersionStatus isFirstTimeSetup={isFirstTimeSetup} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
