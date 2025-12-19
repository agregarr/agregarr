import Alert from '@app/components/Common/Alert';
import Modal from '@app/components/Common/Modal';
import axios from 'axios';
import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';

const messages = defineMessages({
  exportDebug: 'Export Debugging Information',
  exportDescription:
    'Select which data to include in the debug export. This will create a zip file containing the selected information.',
  exportWarning:
    'Warning: The exported debug information is not sanitised and contains sensitive data such as tokens and API keys. This tool should only be used at the specific request of the Agregarr Developer. Do not share this file publicly. If you want to sanitise the data, you can manually remove sensitive information after exporting.',
  selectItems: 'Select items to export:',
  database: 'Database (db.sqlite3)',
  settings: 'Settings (settings.json)',
  logs: 'Logs',
  exportButton: 'Export',
  cancel: 'Cancel',
  exporting: 'Preparing export...',
  exportSuccess: 'Debug export downloaded successfully',
  exportFailed: 'Failed to export debug information',
  noItemsSelected: 'Please select at least one item to export',
});

interface ExportDebugModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ExportDebugModal: React.FC<ExportDebugModalProps> = ({
  isOpen,
  onClose,
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();

  const [includeDatabase, setIncludeDatabase] = useState(true);
  const [includeSettings, setIncludeSettings] = useState(true);
  const [includeLogs, setIncludeLogs] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  if (!isOpen) return null;

  const handleExport = async () => {
    // Validate at least one item is selected
    if (!includeDatabase && !includeSettings && !includeLogs) {
      addToast(intl.formatMessage(messages.noItemsSelected), {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    setIsExporting(true);

    try {
      const response = await axios.post(
        '/api/v1/settings/export-debug',
        {
          includeDatabase,
          includeSettings,
          includeLogs,
        },
        {
          responseType: 'blob',
        }
      );

      // Create a download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;

      // Get filename from content-disposition header or use default
      const contentDisposition = response.headers['content-disposition'];
      let filename = 'agregarr-debug.zip';
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      addToast(intl.formatMessage(messages.exportSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });

      onClose();
    } catch (error) {
      addToast(
        error instanceof Error
          ? error.message
          : intl.formatMessage(messages.exportFailed),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Modal
      title={intl.formatMessage(messages.exportDebug)}
      onCancel={onClose}
      cancelText={intl.formatMessage(messages.cancel)}
      okText={intl.formatMessage(messages.exportButton)}
      onOk={handleExport}
      okButtonType="primary"
      okDisabled={isExporting}
    >
      <div className="space-y-6">
        <p className="text-sm text-gray-300">
          {intl.formatMessage(messages.exportDescription)}
        </p>
        <Alert type="warning">
          {intl.formatMessage(messages.exportWarning)}
        </Alert>

        <div className="space-y-3">
          <p className="text-sm font-medium text-white">
            {intl.formatMessage(messages.selectItems)}
          </p>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-center space-x-3">
              <input
                type="checkbox"
                checked={includeDatabase}
                onChange={(e) => setIncludeDatabase(e.target.checked)}
                className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-300">
                {intl.formatMessage(messages.database)}
              </span>
            </label>

            <label className="flex cursor-pointer items-center space-x-3">
              <input
                type="checkbox"
                checked={includeSettings}
                onChange={(e) => setIncludeSettings(e.target.checked)}
                className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-300">
                {intl.formatMessage(messages.settings)}
              </span>
            </label>

            <label className="flex cursor-pointer items-center space-x-3">
              <input
                type="checkbox"
                checked={includeLogs}
                onChange={(e) => setIncludeLogs(e.target.checked)}
                className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-300">
                {intl.formatMessage(messages.logs)}
              </span>
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default ExportDebugModal;
