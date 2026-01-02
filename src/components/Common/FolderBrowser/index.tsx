import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import { ChevronRightIcon, FolderIcon } from '@heroicons/react/24/outline';
import { HomeIcon } from '@heroicons/react/24/solid';
import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  selectFolder: 'Select Folder',
  currentPath: 'Current Path',
  loading: 'Loading directories...',
  errorLoading: 'Failed to load directories',
  noDirectories: 'No subdirectories found',
  goToParent: 'Go to parent directory',
  goToRoot: 'Go to Root',
  select: 'Select',
  cancel: 'Cancel',
  selectedPath: 'Selected: {path}',
});

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface BrowseResponse {
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
}

interface FolderBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  title?: string;
}

const FolderBrowser = ({
  isOpen,
  onClose,
  onSelect,
  initialPath = '/',
  title,
}: FolderBrowserProps) => {
  const intl = useIntl();
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>(initialPath);

  const loadDirectory = useCallback(
    async (path: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await axios.get<BrowseResponse>(
          '/api/v1/filesystem/browse',
          {
            params: { path },
          }
        );
        setCurrentPath(response.data.currentPath);
        setDirectories(response.data.directories);
        setParentPath(response.data.parentPath);
        setSelectedPath(response.data.currentPath);
      } catch (err) {
        setError(intl.formatMessage(messages.errorLoading));
      } finally {
        setIsLoading(false);
      }
    },
    [intl]
  );

  useEffect(() => {
    if (isOpen) {
      loadDirectory(initialPath);
    }
  }, [isOpen, initialPath, loadDirectory]);

  const handleDirectoryClick = (path: string) => {
    loadDirectory(path);
  };

  const handleParentClick = () => {
    if (parentPath) {
      loadDirectory(parentPath);
    }
  };

  const handleRootClick = () => {
    loadDirectory('/');
  };

  const handleSelect = () => {
    onSelect(selectedPath);
    onClose();
  };

  return (
    <Modal
      title={title || intl.formatMessage(messages.selectFolder)}
      onCancel={onClose}
      onOk={handleSelect}
      okText={intl.formatMessage(messages.select)}
      cancelText={intl.formatMessage(messages.cancel)}
      okButtonType="primary"
    >
      <div className="space-y-4">
        {/* Current Path Display */}
        <div className="rounded-md bg-stone-700 p-3">
          <div className="mb-1 text-xs font-medium text-stone-400">
            {intl.formatMessage(messages.currentPath)}
          </div>
          <div className="flex items-center space-x-2 text-sm text-white">
            <HomeIcon className="h-4 w-4 flex-shrink-0" />
            <span className="break-all font-mono">{currentPath}</span>
          </div>
        </div>

        {/* Navigation Buttons */}
        <div className="flex gap-2">
          {parentPath && (
            <Button
              buttonType="default"
              className="flex-1"
              onClick={handleParentClick}
              disabled={isLoading}
            >
              <span>.. (Parent Directory)</span>
            </Button>
          )}
          <Button
            buttonType="default"
            className={parentPath ? 'flex-shrink-0' : 'w-full'}
            onClick={handleRootClick}
            disabled={isLoading || currentPath === '/'}
          >
            <HomeIcon className="mr-2 inline-block h-4 w-4" />
            <span>{intl.formatMessage(messages.goToRoot)}</span>
          </Button>
        </div>

        {/* Directory List */}
        <div className="max-h-96 overflow-y-auto rounded-md border border-stone-600 bg-stone-800">
          {isLoading && (
            <div className="flex items-center justify-center p-8">
              <LoadingSpinner />
              <span className="ml-3 text-stone-400">
                {intl.formatMessage(messages.loading)}
              </span>
            </div>
          )}

          {!isLoading && error && (
            <div className="p-4 text-center text-red-400">{error}</div>
          )}

          {!isLoading && !error && directories.length === 0 && (
            <div className="p-4 text-center text-stone-400">
              {intl.formatMessage(messages.noDirectories)}
            </div>
          )}

          {!isLoading && !error && directories.length > 0 && (
            <ul className="divide-y divide-stone-700">
              {directories.map((dir) => (
                <li key={dir.path}>
                  <button
                    onClick={() => handleDirectoryClick(dir.path)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-stone-700"
                  >
                    <div className="flex items-center space-x-3">
                      <FolderIcon className="h-5 w-5 flex-shrink-0 text-yellow-500" />
                      <span className="text-sm text-white">{dir.name}</span>
                    </div>
                    <ChevronRightIcon className="h-4 w-4 text-stone-400" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Selected Path Display */}
        <div className="rounded-md bg-stone-900 p-3 text-xs text-stone-400">
          {intl.formatMessage(messages.selectedPath, {
            path: selectedPath,
          })}
        </div>
      </div>
    </Modal>
  );
};

export default FolderBrowser;
