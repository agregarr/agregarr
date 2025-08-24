import SettingsDownloads from '@app/components/Settings/SettingsDownloads';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const DownloadsSettingsPage: NextPage = () => {
  useRouteGuard(Permission.ADMIN);
  return (
    <SettingsLayout>
      <SettingsDownloads />
    </SettingsLayout>
  );
};

export default DownloadsSettingsPage;
