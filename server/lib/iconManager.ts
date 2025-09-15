import logger from '@server/logger';
import axios from 'axios';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const ICONS_STORAGE_DIR = path.join(process.cwd(), 'config', 'icons');
const SYSTEM_ICONS_DIR = path.join(process.cwd(), 'public', 'icons');
const ALLOWED_ICON_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
];
const MAX_ICON_SIZE = 2 * 1024 * 1024; // 2MB
const ICON_THUMBNAIL_SIZE = 64; // 64x64 thumbnails

export interface IconMetadata {
  id: string;
  name: string;
  filename: string;
  type: 'user' | 'system';
  category?: string;
  tags?: string[];
  mimeType: string;
  size: number;
  thumbnailFilename?: string;
  uploadedAt: string;
  description?: string;
}

export interface IconCategory {
  name: string;
  displayName: string;
  description: string;
  iconCount: number;
}

const ICON_METADATA_FILE = path.join(ICONS_STORAGE_DIR, 'icons-metadata.json');

/**
 * Initialize icon storage directories
 */
export async function initializeIconStorage(): Promise<void> {
  try {
    // Create icons directory if it doesn't exist
    if (!fs.existsSync(ICONS_STORAGE_DIR)) {
      fs.mkdirSync(ICONS_STORAGE_DIR, { recursive: true });
      logger.info(`Created icons storage directory: ${ICONS_STORAGE_DIR}`);
    }

    // Create system icons directory if it doesn't exist
    if (!fs.existsSync(SYSTEM_ICONS_DIR)) {
      fs.mkdirSync(SYSTEM_ICONS_DIR, { recursive: true });
      logger.info(`Created system icons directory: ${SYSTEM_ICONS_DIR}`);
    }

    // Initialize metadata file if it doesn't exist
    if (!fs.existsSync(ICON_METADATA_FILE)) {
      await saveIconMetadata([]);
      logger.info('Initialized icons metadata file');
    }

    // Seed system icons if they don't exist
    await seedSystemIcons();
  } catch (error) {
    logger.error('Failed to initialize icon storage:', error);
    throw error;
  }
}

/**
 * Load icon metadata from disk
 */
async function loadIconMetadata(): Promise<IconMetadata[]> {
  try {
    if (!fs.existsSync(ICON_METADATA_FILE)) {
      return [];
    }

    const data = await fs.promises.readFile(ICON_METADATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.warn('Failed to load icon metadata, returning empty array:', error);
    return [];
  }
}

/**
 * Save icon metadata to disk
 */
async function saveIconMetadata(metadata: IconMetadata[]): Promise<void> {
  try {
    await fs.promises.writeFile(
      ICON_METADATA_FILE,
      JSON.stringify(metadata, null, 2),
      'utf8'
    );
  } catch (error) {
    logger.error('Failed to save icon metadata:', error);
    throw error;
  }
}

/**
 * Scan for new user icons in the icons directory that aren't in metadata
 */
async function scanForNewIcons(): Promise<void> {
  try {
    if (!fs.existsSync(ICONS_STORAGE_DIR)) {
      return;
    }

    const files = await fs.promises.readdir(ICONS_STORAGE_DIR);
    const iconFiles = files.filter(
      (file) =>
        ['.svg', '.png', '.jpg', '.jpeg', '.webp'].includes(
          path.extname(file).toLowerCase()
        ) &&
        !file.startsWith('thumb_') &&
        file !== 'icons-metadata.json'
    );

    if (iconFiles.length === 0) {
      return;
    }

    const metadata = await loadIconMetadata();
    let addedCount = 0;

    for (const file of iconFiles) {
      // Check if this file is already in metadata
      const existingIcon = metadata.find((icon) => icon.filename === file);
      if (existingIcon) {
        continue; // Skip existing files
      }

      try {
        const filePath = path.join(ICONS_STORAGE_DIR, file);
        const stats = await fs.promises.stat(filePath);
        const ext = path.extname(file).toLowerCase();

        // Determine mime type
        const mimeTypeMap: Record<string, string> = {
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
        };
        const mimeType = mimeTypeMap[ext] || 'image/png';

        // Create metadata entry for the found file
        const iconName = path.parse(file).name;
        const iconMetadata: IconMetadata = {
          id: `user-${iconName}-${Date.now()}`,
          name: iconName,
          filename: file,
          type: 'user',
          category: 'user-uploads',
          tags: ['user', iconName],
          mimeType,
          size: stats.size,
          uploadedAt: new Date(stats.mtime).toISOString(),
          description: `User uploaded ${iconName}`,
        };

        metadata.push(iconMetadata);
        addedCount++;

        logger.debug(`Found new user icon: ${iconName}`, {
          filename: file,
          size: stats.size,
        });
      } catch (error) {
        logger.warn(`Failed to process found icon ${file}:`, error);
      }
    }

    if (addedCount > 0) {
      await saveIconMetadata(metadata);
      logger.info(`Found and added ${addedCount} new user icons`);
    }
  } catch (error) {
    logger.error('Failed to scan for new icons:', error);
  }
}

/**
 * Seed system icons (copy from public/services to public/icons)
 */
async function seedSystemIcons(): Promise<void> {
  try {
    const servicesDir = path.join(process.cwd(), 'public', 'services');

    if (!fs.existsSync(servicesDir)) {
      logger.debug('Services directory not found, skipping system icons seed');
      return;
    }

    const serviceFiles = await fs.promises.readdir(servicesDir);
    const svgFiles = serviceFiles.filter((file) => file.endsWith('.svg'));

    if (svgFiles.length === 0) {
      logger.debug('No SVG files found in services directory');
      return;
    }

    const metadata = await loadIconMetadata();
    let addedCount = 0;

    for (const svgFile of svgFiles) {
      const iconName = path.parse(svgFile).name;

      // Check if system icon already exists
      const existingIcon = metadata.find(
        (icon) => icon.type === 'system' && icon.name === iconName
      );

      if (existingIcon) {
        continue; // Skip existing icons
      }

      try {
        // Copy SVG to system icons directory
        const sourcePath = path.join(servicesDir, svgFile);
        const targetPath = path.join(SYSTEM_ICONS_DIR, svgFile);

        await fs.promises.copyFile(sourcePath, targetPath);

        // Get file stats
        const stats = await fs.promises.stat(targetPath);

        // Create metadata entry
        const iconMetadata: IconMetadata = {
          id: `system-${iconName}`,
          name: iconName,
          filename: svgFile,
          type: 'system',
          category: 'services',
          tags: ['service', iconName],
          mimeType: 'image/svg+xml',
          size: stats.size,
          uploadedAt: new Date().toISOString(),
          description: `${iconName} service logo`,
        };

        metadata.push(iconMetadata);
        addedCount++;

        logger.debug(`Added system icon: ${iconName}`, {
          filename: svgFile,
          size: stats.size,
        });
      } catch (error) {
        logger.warn(`Failed to seed system icon ${svgFile}:`, error);
      }
    }

    if (addedCount > 0) {
      await saveIconMetadata(metadata);
      logger.info(`Seeded ${addedCount} system icons`);
    }
  } catch (error) {
    logger.error('Failed to seed system icons:', error);
  }
}

/**
 * Upload and save an icon file
 */
export async function uploadIcon(
  fileBuffer: Buffer,
  mimeType: string,
  originalName: string,
  options: {
    name?: string;
    category?: string;
    tags?: string[];
    description?: string;
  } = {}
): Promise<IconMetadata> {
  try {
    // Validate mime type
    if (!ALLOWED_ICON_TYPES.includes(mimeType)) {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    // Validate file size
    if (fileBuffer.length > MAX_ICON_SIZE) {
      throw new Error(
        `File too large. Maximum size: ${MAX_ICON_SIZE / (1024 * 1024)}MB`
      );
    }

    // Generate unique filename
    const extension = getFileExtension(mimeType);
    const filename = `${randomUUID()}${extension}`;
    const filePath = path.join(ICONS_STORAGE_DIR, filename);

    // Process and save the icon
    let processedBuffer = fileBuffer;
    let thumbnailFilename: string | undefined;

    if (mimeType !== 'image/svg+xml') {
      // For raster images, ensure reasonable size and create thumbnail
      processedBuffer = await sharp(fileBuffer)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .png({ quality: 90 })
        .toBuffer();

      // Create thumbnail
      const thumbnailBuffer = await sharp(fileBuffer)
        .resize(ICON_THUMBNAIL_SIZE, ICON_THUMBNAIL_SIZE, { fit: 'inside' })
        .png({ quality: 80 })
        .toBuffer();

      thumbnailFilename = `thumb_${filename.replace(extension, '.png')}`;
      const thumbnailPath = path.join(ICONS_STORAGE_DIR, thumbnailFilename);
      await fs.promises.writeFile(thumbnailPath, thumbnailBuffer);
    }

    // Save the main icon file
    await fs.promises.writeFile(filePath, processedBuffer);

    // Create metadata
    const iconMetadata: IconMetadata = {
      id: randomUUID(),
      name: options.name || path.parse(originalName).name,
      filename,
      type: 'user',
      category: options.category || 'user-uploads',
      tags: options.tags || [],
      mimeType,
      size: processedBuffer.length,
      thumbnailFilename,
      uploadedAt: new Date().toISOString(),
      description: options.description,
    };

    // Update metadata
    const metadata = await loadIconMetadata();
    metadata.push(iconMetadata);
    await saveIconMetadata(metadata);

    logger.info('Uploaded icon', {
      id: iconMetadata.id,
      name: iconMetadata.name,
      filename,
      size: processedBuffer.length,
      mimeType,
    });

    return iconMetadata;
  } catch (error) {
    logger.error('Failed to upload icon:', error);
    throw error;
  }
}

/**
 * Download and save an icon from URL
 */
export async function downloadIcon(
  url: string,
  options: {
    name?: string;
    category?: string;
    tags?: string[];
    description?: string;
  } = {}
): Promise<IconMetadata> {
  try {
    logger.debug('Downloading icon from URL', { url });

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: MAX_ICON_SIZE,
      headers: {
        'User-Agent': 'Agregarr/1.0.0',
      },
    });

    const buffer = Buffer.from(response.data);
    const contentType = response.headers['content-type'] || 'image/png';

    // Validate content type
    if (!ALLOWED_ICON_TYPES.includes(contentType)) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    // Extract filename from URL or generate one
    const urlPath = new URL(url).pathname;
    const originalName =
      options.name || path.basename(urlPath) || 'downloaded-icon';

    return await uploadIcon(buffer, contentType, originalName, options);
  } catch (error) {
    logger.error('Failed to download icon from URL:', error);
    throw error;
  }
}

/**
 * Get all icons with optional filtering
 */
export async function getIcons(
  filters: {
    type?: 'user' | 'system';
    category?: string;
    tags?: string[];
    search?: string;
  } = {}
): Promise<IconMetadata[]> {
  try {
    // Scan for new icons first
    await scanForNewIcons();

    let icons = await loadIconMetadata();

    // Apply filters
    if (filters.type) {
      icons = icons.filter((icon) => icon.type === filters.type);
    }

    if (filters.category) {
      icons = icons.filter((icon) => icon.category === filters.category);
    }

    if (filters.tags && filters.tags.length > 0) {
      icons = icons.filter((icon) =>
        icon.tags?.some((tag) => filters.tags?.includes(tag) ?? false)
      );
    }

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      icons = icons.filter(
        (icon) =>
          icon.name.toLowerCase().includes(searchLower) ||
          icon.description?.toLowerCase().includes(searchLower) ||
          icon.tags?.some((tag) => tag.toLowerCase().includes(searchLower))
      );
    }

    return icons.sort((a, b) => {
      // Sort system icons first, then by upload date
      if (a.type !== b.type) {
        return a.type === 'system' ? -1 : 1;
      }
      return (
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );
    });
  } catch (error) {
    logger.error('Failed to get icons:', error);
    throw error;
  }
}

/**
 * Get icon categories
 */
export async function getIconCategories(): Promise<IconCategory[]> {
  try {
    const icons = await loadIconMetadata();
    const categoryMap = new Map<string, IconCategory>();

    icons.forEach((icon) => {
      const categoryName = icon.category || 'uncategorized';

      if (!categoryMap.has(categoryName)) {
        categoryMap.set(categoryName, {
          name: categoryName,
          displayName: getCategoryDisplayName(categoryName),
          description: getCategoryDescription(categoryName),
          iconCount: 0,
        });
      }

      const category = categoryMap.get(categoryName);
      if (category) {
        category.iconCount++;
      }
    });

    return Array.from(categoryMap.values()).sort((a, b) => {
      // Sort system categories first
      if (a.name === 'services') return -1;
      if (b.name === 'services') return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  } catch (error) {
    logger.error('Failed to get icon categories:', error);
    throw error;
  }
}

/**
 * Delete an icon
 */
export async function deleteIcon(iconId: string): Promise<void> {
  try {
    const metadata = await loadIconMetadata();
    const iconIndex = metadata.findIndex((icon) => icon.id === iconId);

    if (iconIndex === -1) {
      throw new Error('Icon not found');
    }

    const icon = metadata[iconIndex];

    // Don't allow deleting system icons
    if (icon.type === 'system') {
      throw new Error('Cannot delete system icons');
    }

    // Delete files
    const iconPath = path.join(ICONS_STORAGE_DIR, icon.filename);
    if (fs.existsSync(iconPath)) {
      await fs.promises.unlink(iconPath);
    }

    if (icon.thumbnailFilename) {
      const thumbnailPath = path.join(
        ICONS_STORAGE_DIR,
        icon.thumbnailFilename
      );
      if (fs.existsSync(thumbnailPath)) {
        await fs.promises.unlink(thumbnailPath);
      }
    }

    // Remove from metadata
    metadata.splice(iconIndex, 1);
    await saveIconMetadata(metadata);

    logger.info('Deleted icon', {
      id: iconId,
      name: icon.name,
      filename: icon.filename,
    });
  } catch (error) {
    logger.error('Failed to delete icon:', error);
    throw error;
  }
}

/**
 * Get icon file path
 */
export function getIconPath(
  filename: string,
  type: 'user' | 'system' = 'user'
): string {
  const dir = type === 'system' ? SYSTEM_ICONS_DIR : ICONS_STORAGE_DIR;
  return path.join(dir, filename);
}

/**
 * Load icon file
 */
export async function loadIconFile(
  filename: string,
  type: 'user' | 'system' = 'user'
): Promise<Buffer> {
  try {
    const filePath = getIconPath(filename, type);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Icon file not found: ${filename}`);
    }

    return await fs.promises.readFile(filePath);
  } catch (error) {
    logger.error('Failed to load icon file:', error);
    throw error;
  }
}

/**
 * Helper functions
 */
function getFileExtension(mimeType: string): string {
  const extensionMap: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
  };
  return extensionMap[mimeType] || '.png';
}

function getCategoryDisplayName(categoryName: string): string {
  const displayNames: Record<string, string> = {
    services: 'Service Logos',
    'user-uploads': 'User Uploads',
    social: 'Social Media',
    tech: 'Technology',
    entertainment: 'Entertainment',
    uncategorized: 'Uncategorized',
  };
  return (
    displayNames[categoryName] ||
    categoryName.charAt(0).toUpperCase() + categoryName.slice(1)
  );
}

function getCategoryDescription(categoryName: string): string {
  const descriptions: Record<string, string> = {
    services: 'Built-in service and platform logos',
    'user-uploads': 'Custom icons uploaded by users',
    social: 'Social media platform icons',
    tech: 'Technology and software icons',
    entertainment: 'Entertainment and media icons',
    uncategorized: 'Icons without a specific category',
  };
  return descriptions[categoryName] || `Icons in the ${categoryName} category`;
}
