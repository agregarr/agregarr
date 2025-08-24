// MiniQuotaDisplay removed - quota system not needed in Agregarr
import { useUser } from '@app/hooks/useUser';
import { Menu, Transition } from '@headlessui/react';
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { Fragment } from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  signout: 'Sign Out',
});

const UserDropdown = () => {
  const intl = useIntl();
  const { user, revalidate } = useUser();

  const logout = async () => {
    const response = await axios.post('/api/v1/auth/logout');

    if (response.data?.status === 'ok') {
      revalidate();
    }
  };

  return (
    <Menu as="div" className="relative ml-3">
      <div>
        <Menu.Button
          className="flex max-w-xs items-center rounded-full text-sm ring-1 ring-slate-700 hover:ring-slate-500 focus:outline-none focus:ring-slate-500"
          data-testid="user-menu"
        >
          <img
            className="h-8 w-8 rounded-full object-cover sm:h-10 sm:w-10"
            src={user?.avatar}
            alt=""
          />
        </Menu.Button>
      </div>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
        appear
      >
        <Menu.Items className="absolute right-0 z-50 mt-2 w-72 origin-top-right rounded-md shadow-sm">
          <div className="divide-y divide-slate-700 rounded-md bg-stone-800 bg-opacity-80 ring-1 ring-slate-700 backdrop-blur">
            <div className="flex flex-col space-y-4 px-4 py-4">
              <div className="flex items-center space-x-2">
                <img
                  className="h-8 w-8 rounded-full object-cover sm:h-10 sm:w-10"
                  src={user?.avatar}
                  alt=""
                />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-xl font-semibold text-slate-200">
                    {user?.displayName}
                  </span>
                  <span className="truncate text-sm text-slate-400">
                    {user?.email}
                  </span>
                </div>
              </div>
              {/* MiniQuotaDisplay removed - quota system not needed in Agregarr */}
            </div>
            <div className="p-1">
              <Menu.Item>
                {({ active }) => (
                  <a
                    href="#"
                    className={`flex items-center rounded px-4 py-2 text-sm font-medium text-slate-200 transition duration-150 ease-in-out ${
                      active
                        ? 'bg-gradient-to-br from-orange-500 to-orange-500 text-white'
                        : ''
                    }`}
                    onClick={() => logout()}
                  >
                    <ArrowRightOnRectangleIcon className="mr-2 inline h-5 w-5" />
                    <span>{intl.formatMessage(messages.signout)}</span>
                  </a>
                )}
              </Menu.Item>
            </div>
          </div>
        </Menu.Items>
      </Transition>
    </Menu>
  );
};

export default UserDropdown;
