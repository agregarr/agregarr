import useSWR from 'swr';

/**
 * Hook to detect if this is a first-time setup where the user needs to discover hubs
 * Returns true if both hub configs and collection configs are empty
 */
export const useFirstTimeSetup = () => {
  const { data: collectionData } = useSWR('/api/v1/collections');
  const { data: hubConfigs } = useSWR('/api/v1/defaulthubs');

  const collectionConfigs = collectionData?.collectionConfigs || [];

  // First-time user if no hubs and no collections configured
  const isFirstTimeSetup =
    (hubConfigs || []).length === 0 && collectionConfigs.length === 0;

  return {
    isFirstTimeSetup,
    hasSettings: !!collectionData,
    hubConfigs: hubConfigs || [],
    collectionConfigs,
  };
};

export default useFirstTimeSetup;
