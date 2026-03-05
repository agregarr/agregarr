import { PlusIcon } from '@heroicons/react/24/outline';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useSWR, { mutate } from 'swr';

interface IconSelectorProps {
  value: string;
  onChange: (iconPath: string) => void;
  id?: string;
  filter?: 'raster' | 'svg' | 'all';
  addToast?: (
    message: string,
    options?: {
      appearance?: 'success' | 'error' | 'warning' | 'info';
      autoDismiss?: boolean;
    }
  ) => void;
}

export const IconSelector: React.FC<IconSelectorProps> = ({
  value,
  onChange,
  id,
  filter = 'all',
  addToast,
}) => {
  const { data: iconsData } = useSWR<{
    icons: {
      id: string;
      name: string;
      filename: string;
      type: 'system' | 'user';
      category: string;
      description: string;
    }[];
  }>('/api/v1/posters/icons');
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calculate dropdown position
  const calculateDropdownPosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 384; // w-96 = 384px
      const dropdownHeight = 300; // Estimated dropdown height

      // Calculate initial position (fixed positioning uses viewport coordinates)
      let left = rect.left;
      let top = rect.bottom + 4;

      // Adjust if dropdown would go off the right edge of viewport
      if (left + dropdownWidth > window.innerWidth) {
        left = rect.right - dropdownWidth; // Align right edge with button right edge
      }

      // Adjust if dropdown would go off the bottom edge of viewport
      if (top + dropdownHeight > window.innerHeight) {
        top = rect.top - dropdownHeight - 4; // Show above the button
      }

      const position = {
        top,
        left: Math.max(8, left), // Ensure at least 8px from left edge
        width: rect.width,
      };
      setDropdownPosition(position);
    }
  }, []);

  // Recalculate position when dropdown opens
  useEffect(() => {
    if (isOpen) {
      calculateDropdownPosition();
    }
  }, [isOpen, calculateDropdownPosition]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const icons = iconsData?.icons || [];

  // Helper function to determine if file is raster or SVG
  const getFileType = (filename: string): 'raster' | 'svg' => {
    const rasterExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const lowerFilename = filename.toLowerCase();
    return rasterExtensions.some((ext) => lowerFilename.endsWith(ext))
      ? 'raster'
      : 'svg';
  };

  // Filter icons by file type only
  let filteredIcons = icons;
  if (filter === 'raster') {
    filteredIcons = icons.filter(
      (icon) => getFileType(icon.filename) === 'raster'
    );
  } else if (filter === 'svg') {
    filteredIcons = icons.filter(
      (icon) => getFileType(icon.filename) === 'svg'
    );
  }

  const selectedIcon = icons.find(
    (icon) => value === `/api/v1/posters/icons/${icon.type}/${icon.filename}`
  );

  // Handle file upload
  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (10MB limit from server)
    if (file.size > 10 * 1024 * 1024) {
      addToast?.('File too large. Maximum size is 10MB.', {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    // Validate file type based on filter
    let allowedTypes: string[] = [];
    let errorMessage = '';

    if (filter === 'raster') {
      allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      errorMessage =
        'Invalid file type. Only JPEG, PNG, and WebP files are allowed for raster images.';
    } else if (filter === 'svg') {
      allowedTypes = ['image/svg+xml'];
      errorMessage = 'Invalid file type. Only SVG files are allowed for icons.';
    } else {
      // 'all' filter
      allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
      errorMessage =
        'Invalid file type. Only JPEG, PNG, WebP, and SVG files are allowed.';
    }

    if (!allowedTypes.includes(file.type)) {
      addToast?.(errorMessage, {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('icon', file);
      formData.append('name', file.name.split('.')[0]); // Remove extension for name
      formData.append('category', 'user-uploads');

      const response = await fetch('/api/v1/uploads/icon', {
        method: 'POST',
        body: formData,
        // Don't set Content-Type - let browser set it with proper boundary
      });

      if (response.ok) {
        const result = await response.json();
        const iconPath = `/api/v1/posters/icons/${result.icon.type}/${result.icon.filename}`;

        // Refresh icons list
        mutate('/api/v1/posters/icons');

        // Select the newly uploaded icon
        onChange(iconPath);
        setIsOpen(false);

        addToast?.('Icon uploaded successfully!', {
          appearance: 'success',
          autoDismiss: true,
        });
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ error: 'Upload failed' }));
        addToast?.(`Failed to upload icon: ${errorData.error}`, {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    } catch (error) {
      addToast?.('Error uploading icon. Please try again.', {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="relative">
      {/* Selected icon display / trigger button */}
      <button
        type="button"
        ref={buttonRef}
        id={id}
        onClick={() => {
          if (!isOpen) {
            calculateDropdownPosition();
            setIsOpen(true);
          } else {
            setIsOpen(false);
          }
        }}
        className="flex w-full items-center justify-between rounded border border-stone-600 bg-stone-800 px-2 py-1 text-xs text-white hover:border-stone-500 focus:border-orange-500 focus:outline-none"
      >
        <div className="flex items-center space-x-2">
          {selectedIcon ? (
            <>
              <img
                src={`/api/v1/posters/icons/${selectedIcon.type}/${selectedIcon.filename}`}
                alt={selectedIcon.name}
                className="h-4 w-4 object-contain"
              />
              <span>{selectedIcon.name}</span>
            </>
          ) : (
            <span className="text-stone-400">
              {filter === 'raster' ? 'Select an image...' : 'Select an icon...'}
            </span>
          )}
        </div>
        <svg
          className={`h-4 w-4 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown Portal */}
      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] w-96 rounded border border-stone-600 bg-stone-800 shadow-lg"
            style={{
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              minWidth: Math.max(dropdownPosition.width, 384), // 384px = w-96
            }}
          >
            {/* Upload button */}
            <div className="border-b border-stone-700 p-2">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
                ref={fileInputRef}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex w-full items-center justify-center space-x-2 rounded border border-stone-600 bg-stone-700 px-2 py-1 text-xs text-white hover:bg-stone-600 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isUploading ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <PlusIcon className="h-4 w-4" />
                    <span>
                      {filter === 'raster' ? 'Upload Image' : 'Upload Icon'}
                    </span>
                  </>
                )}
              </button>
            </div>

            {/* Icon grid */}
            <div className="max-h-72 overflow-y-auto p-2">
              <div
                className={`grid ${
                  filter === 'raster'
                    ? 'grid-cols-3 gap-1'
                    : 'grid-cols-5 gap-2'
                }`}
              >
                {filteredIcons.map((icon) => {
                  const iconPath = `/api/v1/posters/icons/${icon.type}/${icon.filename}`;
                  const isSelected = value === iconPath;

                  return (
                    <button
                      key={icon.id}
                      type="button"
                      onClick={() => {
                        onChange(iconPath);
                        setIsOpen(false);
                      }}
                      className={`group flex items-center justify-center rounded p-2 hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                        isSelected ? 'bg-orange-600 hover:bg-orange-700' : ''
                      }`}
                      title={`${icon.name} (${icon.category})`}
                    >
                      <img
                        src={iconPath}
                        alt={icon.name}
                        className={
                          filter === 'raster'
                            ? 'h-20 w-20 object-contain'
                            : 'h-12 w-12 object-contain'
                        }
                      />
                    </button>
                  );
                })}
              </div>

              {filteredIcons.length === 0 && (
                <div className="py-4 text-center text-xs text-stone-400">
                  {filter === 'raster' ? 'No images found' : 'No icons found'}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
