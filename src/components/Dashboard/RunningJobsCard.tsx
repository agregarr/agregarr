import LibraryProgressCard, {
  type LibraryStatus,
} from '@app/components/PostersView/LibraryProgressCard';
import axios from 'axios';
import { useState } from 'react';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';

interface RunningLibrariesResponse {
  runningLibraries: LibraryStatus[];
}

const RunningJobsCard: React.FC = () => {
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const { addToast } = useToasts();

  const { data, mutate } = useSWR<RunningLibrariesResponse>(
    '/api/v1/overlay-library-configs/status/all',
    {
      refreshInterval: (latestData) => {
        // Only poll when there are running jobs
        const hasRunning = latestData?.runningLibraries?.some(
          (lib) => lib.state === 'running' || lib.state === 'cancelling'
        );
        return hasRunning ? 1000 : 5000; // Slow poll when idle to catch new jobs
      },
      revalidateOnFocus: false,
      dedupingInterval: 1000, // Match refreshInterval for responsive updates
    }
  );

  const runningJobs =
    data?.runningLibraries.filter(
      (lib) => lib.state === 'running' || lib.state === 'cancelling'
    ) || [];

  const handleStop = async (libraryId: string) => {
    if (stoppingIds.has(libraryId)) return; // Prevent double-click

    setStoppingIds((prev) => new Set(prev).add(libraryId));
    try {
      // Cancel via the scheduled jobs system (same as Jobs settings page)
      await axios.post('/api/v1/settings/jobs/overlay-application/cancel');
      addToast('Overlay job cancelled', {
        appearance: 'success',
        autoDismiss: true,
      });
      await mutate();
    } catch (error) {
      addToast('Failed to stop overlay job', {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setStoppingIds((prev) => {
        const next = new Set(prev);
        next.delete(libraryId);
        return next;
      });
    }
  };

  if (runningJobs.length === 0) {
    return null;
  }

  return (
    <div className="mb-6">
      <h3 className="mb-4 text-lg font-semibold text-white">Overlay Jobs</h3>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {runningJobs.map((lib) => (
          <LibraryProgressCard
            key={lib.libraryId}
            status={lib}
            onStop={() => handleStop(lib.libraryId)}
            isStopping={stoppingIds.has(lib.libraryId)}
          />
        ))}
      </div>
    </div>
  );
};

export default RunningJobsCard;
