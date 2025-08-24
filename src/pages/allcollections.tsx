import AllCollectionsView from '@app/components/Collections/Views/All';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const AllCollectionsPage: NextPage = () => {
  useRouteGuard(Permission.ADMIN);
  return <AllCollectionsView />;
};

export default AllCollectionsPage;
