import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsSources from '@app/components/Settings/SettingsSources';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const SourcesSettingsPage: NextPage = () => {
  useRouteGuard(Permission.ADMIN);
  return (
    <SettingsLayout>
      <SettingsSources />
    </SettingsLayout>
  );
};

export default SourcesSettingsPage;
