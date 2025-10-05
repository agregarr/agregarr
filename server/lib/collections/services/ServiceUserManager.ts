import OverseerrAPI, { type OverseerrUser } from '@server/api/overseerr';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { randomUUID } from 'crypto';

/**
 * Configuration for creating service users
 */
export interface ServiceUserConfig {
  username: string;
  displayName: string;
  email: string;
  permissions: number;
  avatar?: string;
  description?: string;
}

/**
 * Service types for user creation
 */
export type ServiceType =
  | 'trakt'
  | 'tmdb'
  | 'imdb'
  | 'mdblist'
  | 'letterboxd'
  | 'networks'
  | 'originals'
  | 'tautulli'
  | 'overseerr';

/**
 * Generate service user configuration dynamically
 */
export function generateServiceUserConfig(
  serviceType: ServiceType,
  collectionType?: string,
  userCreationMode: 'single' | 'per-service' | 'granular' = 'per-service'
): ServiceUserConfig {
  const serviceInfo = {
    trakt: { name: 'Trakt', avatar: '/trakt-logo.svg' },
    tmdb: { name: 'TMDB', avatar: '/tmdb-logo.svg' },
    imdb: { name: 'IMDb', avatar: '/imdb-logo.svg' },
    mdblist: { name: 'MDBList', avatar: '/services/mdblist.svg' },
    letterboxd: { name: 'Letterboxd', avatar: '/letterboxd-logo.svg' },
    networks: { name: 'Networks', avatar: '/networks-logo.svg' },
    originals: { name: 'Originals', avatar: '/logo_stacked.svg' },
    tautulli: { name: 'Tautulli', avatar: '/tautulli-logo.svg' },
    overseerr: { name: 'Overseerr', avatar: '/os_logo_stacked.svg' },
  }[serviceType];

  let username: string;
  let displayName: string;
  let email: string;
  let avatar: string;
  let description: string;

  switch (userCreationMode) {
    case 'single':
      // Single mode: Everything goes to "Agregarr"
      username = 'Agregarr';
      displayName = 'Agregarr';
      email = 'donotchangeme@agregarr';
      avatar = '/logo_stacked.svg';
      description = 'Virtual service user for all Agregarr collection requests';
      break;

    case 'granular':
      if (collectionType) {
        // Granular mode: TraktTrendingAgregarr, TMDbPopularAgregarr, etc.
        const collectionName =
          collectionType.charAt(0).toUpperCase() + collectionType.slice(1);
        username = `${serviceInfo.name}${collectionName}Agregarr`;
        displayName = username;
        email = `donotchangeme@${serviceType.toLowerCase()}.${collectionType.toLowerCase()}.agregarr`;
        avatar = serviceInfo.avatar;
        description = `Virtual service user for ${serviceInfo.name} ${collectionName} collection requests`;
      } else {
        // Fallback to per-service if no collection type
        username = `${serviceInfo.name}Agregarr`;
        displayName = username;
        email = `donotchangeme@${serviceType.toLowerCase()}.agregarr`;
        avatar = serviceInfo.avatar;
        description = `Virtual service user for ${serviceInfo.name} collection requests`;
      }
      break;

    case 'per-service':
    default:
      // Per-service mode: TraktAgregarr, TMDbAgregarr, etc.
      username = `${serviceInfo.name}Agregarr`;
      displayName = username;
      email = `donotchangeme@${serviceType.toLowerCase()}.agregarr`;
      avatar = serviceInfo.avatar;
      description = `Virtual service user for ${serviceInfo.name} collection requests`;
      break;
  }

  return {
    username,
    displayName,
    email,
    permissions: 32, // Start with manual approval permissions (will be changed dynamically)
    avatar,
    description,
  };
}

/**
 * Service User Manager for creating and managing virtual users
 *
 * Handles creation, retrieval, and management of service users used by
 * collection sync processes for auto-requests and other automated operations.
 */
export class ServiceUserManager {
  private userRepository = getRepository(User);
  private overseerrAPI: OverseerrAPI | null = null;

  /**
   * Get or initialize Overseerr API client
   */
  private getOverseerrAPI(): OverseerrAPI {
    if (!this.overseerrAPI) {
      const settings = getSettings();
      if (!settings.overseerr.hostname || !settings.overseerr.apiKey) {
        throw new Error(
          'External Overseerr not configured for service user management'
        );
      }
      this.overseerrAPI = new OverseerrAPI(settings.overseerr);
    }
    return this.overseerrAPI;
  }

  /**
   * Get or create a service user based on configuration
   *
   * @param config - Service user configuration
   * @returns Promise resolving to the service user
   */
  public async getOrCreateServiceUser(
    config: ServiceUserConfig
  ): Promise<User> {
    // Try to find existing service user by email (unique identifier)
    let serviceUser = await this.userRepository.findOne({
      where: { email: config.email },
    });

    if (!serviceUser) {
      // Create new service user (both internal and external)
      serviceUser = await this.createServiceUser(config);

      logger.info(`Created virtual service user: ${config.displayName}`, {
        label: 'Service User Manager',
        username: config.username,
        email: config.email,
        permissions: config.permissions,
        externalOverseerrId: serviceUser.externalOverseerrId,
      });
    } else {
      // Ensure user exists in external Overseerr and has correct permissions
      await this.ensureExternalUser(serviceUser, config);

      // Update existing service user if permissions have changed
      const hasPermissionChanges =
        serviceUser.permissions !== config.permissions;
      const hasDisplayNameChanges =
        serviceUser.displayName !== config.displayName;

      if (hasPermissionChanges || hasDisplayNameChanges) {
        serviceUser.permissions = config.permissions;
        serviceUser.displayName = config.displayName;
        serviceUser.updatedAt = new Date();

        await this.userRepository.save(serviceUser);

        // Also update permissions in external Overseerr if they changed
        if (hasPermissionChanges && serviceUser.externalOverseerrId) {
          try {
            const overseerrAPI = this.getOverseerrAPI();
            const overseerrPermissions = this.mapToOverseerrPermissions(
              config.permissions
            );
            await overseerrAPI.updateUserPermissions(
              serviceUser.externalOverseerrId,
              overseerrPermissions
            );

            logger.info(
              `Updated external Overseerr permissions for: ${config.displayName}`,
              {
                label: 'Service User Manager',
                externalUserId: serviceUser.externalOverseerrId,
                newPermissions: overseerrPermissions,
              }
            );
          } catch (error) {
            // If permission update fails (likely due to stale user ID), re-ensure external user
            logger.warn(
              `Permission update failed for external user ${serviceUser.externalOverseerrId}, re-ensuring user: ${config.displayName}`,
              {
                label: 'Service User Manager',
                externalUserId: serviceUser.externalOverseerrId,
                error: error instanceof Error ? error.message : String(error),
              }
            );

            // Clear stale external user ID and re-ensure external user
            serviceUser.externalOverseerrId = undefined;
            await this.userRepository.save(serviceUser);
            await this.ensureExternalUser(serviceUser, config);
          }
        }

        logger.info(`Updated virtual service user: ${config.displayName}`, {
          label: 'Service User Manager',
          username: config.username,
          permissionsChanged: hasPermissionChanges,
          displayNameChanged: hasDisplayNameChanges,
        });
      }
    }

    return serviceUser;
  }

  /**
   * Get or create service user by type with settings consideration
   */
  public async getOrCreateServiceUserByType(
    serviceType: ServiceType,
    collectionType?: string
  ): Promise<User> {
    const settings = getSettings();
    const userCreationMode =
      settings.serviceUser?.userCreationMode ?? 'per-service';

    const config = generateServiceUserConfig(
      serviceType,
      collectionType,
      userCreationMode
    );
    return this.getOrCreateServiceUser(config);
  }

  /**
   * Get or create service user with dynamic permissions
   */
  public async getOrCreateServiceUserForRequest(
    serviceType: ServiceType,
    collectionType: string | undefined,
    autoApprove: boolean
  ): Promise<User> {
    const settings = getSettings();
    const userCreationMode =
      settings.serviceUser?.userCreationMode ?? 'per-service';

    // Generate config
    const config = generateServiceUserConfig(
      serviceType,
      collectionType,
      userCreationMode
    );

    // Override permissions based on auto-approve setting
    config.permissions = autoApprove ? 928 : 32; // 928 = auto-approve, 32 = manual

    return this.getOrCreateServiceUser(config);
  }

  // Note: Virtual user creation removed - not needed since collection functions
  // ignore user parameter when custom titles and global collection flags are used

  /**
   * Clean up orphaned service users
   *
   * Removes service users that are no longer needed or have been replaced
   * by newer configurations.
   */
  public async cleanupOrphanedServiceUsers(): Promise<number> {
    // Get all service users (emails starting with donotchangeme@)
    const allServiceUsers = await this.userRepository
      .createQueryBuilder('user')
      .where('user.email LIKE :pattern', { pattern: 'donotchangeme@%' })
      .getMany();

    if (allServiceUsers.length === 0) {
      return 0;
    }

    // For now, don't auto-cleanup users since the new system is dynamic
    // Users should manually clean up old users after transitioning
    logger.info(`Found ${allServiceUsers.length} service users`, {
      label: 'Service User Manager',
      users: allServiceUsers.map((u) => ({
        email: u.email,
        displayName: u.displayName,
      })),
    });

    return 0; // No cleanup performed automatically
  }

  /**
   * List all active service users
   */
  public async listServiceUsers(): Promise<User[]> {
    return this.userRepository
      .createQueryBuilder('user')
      .where('user.email LIKE :pattern', { pattern: 'donotchangeme@%' })
      .getMany();
  }

  /**
   * Create a new service user (both internal and external)
   */
  private async createServiceUser(config: ServiceUserConfig): Promise<User> {
    const overseerrAPI = this.getOverseerrAPI();

    // First, check if user already exists in external Overseerr
    let externalUser = await this.findExistingUserByEmail(config.email);

    if (externalUser) {
      // User exists, update permissions
      const overseerrPermissions = this.mapToOverseerrPermissions(
        config.permissions
      );
      await overseerrAPI.updateUserPermissions(
        externalUser.id,
        overseerrPermissions
      );

      logger.debug(
        `Found existing external Overseerr user: ${config.username}`,
        {
          label: 'Service User Manager',
          externalUserId: externalUser.id,
          permissions: overseerrPermissions,
        }
      );
    } else {
      // User doesn't exist, create new one
      try {
        const password = this.generateSecurePassword();
        externalUser = await overseerrAPI.createUser({
          username: config.username,
          email: config.email,
          password: password,
          displayName: config.displayName,
        });

        // Set appropriate permissions
        const overseerrPermissions = this.mapToOverseerrPermissions(
          config.permissions
        );
        await overseerrAPI.updateUserPermissions(
          externalUser.id,
          overseerrPermissions
        );

        logger.debug(`Created external Overseerr user: ${config.username}`, {
          label: 'Service User Manager',
          externalUserId: externalUser.id,
          permissions: overseerrPermissions,
        });
      } catch (error) {
        logger.error(
          `Failed to create external Overseerr user: ${config.username}`,
          {
            label: 'Service User Manager',
            error: error instanceof Error ? error.message : String(error),
          }
        );
        throw new Error(`Failed to create external Overseerr user: ${error}`);
      }
    }

    // Create internal user with external ID mapping
    const serviceUser = new User({
      email: config.email,
      username: config.username,
      displayName: config.displayName,
      plexUsername: config.username,
      plexTitle: config.displayName,
      permissions: config.permissions,
      userType: 1, // LOCAL user type
      avatar: config.avatar || '/logo_stacked.svg',
      externalOverseerrId: externalUser.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return await this.userRepository.save(serviceUser);
  }

  /**
   * Ensure user exists in external Overseerr and has correct permissions
   */
  private async ensureExternalUser(
    user: User,
    config: ServiceUserConfig
  ): Promise<void> {
    const overseerrAPI = this.getOverseerrAPI();

    if (!user.externalOverseerrId) {
      // User doesn't have external ID, check if user exists in external Overseerr
      let externalUser = await this.findExistingUserByEmail(config.email);

      if (externalUser) {
        // Found existing external user, link it
        user.externalOverseerrId = externalUser.id;
        await this.userRepository.save(user);

        logger.info(
          `Linked existing service user to external Overseerr: ${config.username}`,
          {
            label: 'Service User Manager',
            externalUserId: externalUser.id,
          }
        );
      } else {
        // External user doesn't exist, create it
        try {
          const password = this.generateSecurePassword();
          externalUser = await overseerrAPI.createUser({
            username: config.username,
            email: config.email,
            password: password,
            displayName: config.displayName,
          });

          // Update internal user with external ID
          user.externalOverseerrId = externalUser.id;
          await this.userRepository.save(user);

          logger.info(
            `Created and linked external user for existing service user: ${config.username}`,
            {
              label: 'Service User Manager',
              externalUserId: externalUser.id,
            }
          );
        } catch (error) {
          logger.error(
            `Failed to create external user for existing service user: ${config.username}`,
            {
              label: 'Service User Manager',
              error: error instanceof Error ? error.message : String(error),
            }
          );
          return;
        }
      }

      // Set appropriate permissions for the external user (new or existing)
      try {
        const overseerrPermissions = this.mapToOverseerrPermissions(
          config.permissions
        );
        await overseerrAPI.updateUserPermissions(
          externalUser.id,
          overseerrPermissions
        );
      } catch (error) {
        logger.error(
          `Failed to set permissions for external user: ${config.username}`,
          {
            label: 'Service User Manager',
            externalUserId: externalUser.id,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    } else {
      // User exists externally, ensure permissions are correct
      try {
        const overseerrPermissions = this.mapToOverseerrPermissions(
          config.permissions
        );
        await overseerrAPI.updateUserPermissions(
          user.externalOverseerrId,
          overseerrPermissions
        );
      } catch (error) {
        // If permission update fails (likely due to stale user ID), clear and recreate
        logger.warn(
          `Permission update failed for external user ${user.externalOverseerrId}, recreating user: ${config.username}`,
          {
            label: 'Service User Manager',
            externalUserId: user.externalOverseerrId,
            error: error instanceof Error ? error.message : String(error),
          }
        );

        // Clear stale external user ID and recreate
        user.externalOverseerrId = undefined;
        await this.userRepository.save(user);

        // Try to find existing user by email first, or create new one
        let externalUser = await this.findExistingUserByEmail(config.email);

        if (!externalUser) {
          // External user doesn't exist, create it
          const password = this.generateSecurePassword();
          externalUser = await overseerrAPI.createUser({
            username: config.username,
            email: config.email,
            password: password,
            displayName: config.displayName,
          });
        }

        // Update internal user with external ID
        user.externalOverseerrId = externalUser.id;
        await this.userRepository.save(user);

        // Set appropriate permissions for the external user
        const overseerrPermissions = this.mapToOverseerrPermissions(
          config.permissions
        );
        await overseerrAPI.updateUserPermissions(
          externalUser.id,
          overseerrPermissions
        );
      }
    }
  }

  /**
   * Find existing user in external Overseerr by email
   */
  private async findExistingUserByEmail(
    email: string
  ): Promise<OverseerrUser | null> {
    try {
      const overseerrAPI = this.getOverseerrAPI();

      // Get all users and find by email (Overseerr doesn't have direct email search)
      const usersResponse = await overseerrAPI.getUsers({ take: 1000 }); // Get a large batch
      const existingUser = usersResponse.results.find(
        (user) => user.email === email
      );

      return existingUser || null;
    } catch (error) {
      logger.warn(`Failed to search for existing user by email: ${email}`, {
        label: 'Service User Manager',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Map internal permissions to Overseerr permission values
   */
  private mapToOverseerrPermissions(internalPermissions: number): number {
    // Based on your examples:
    // Manual approval (REQUEST only): 32
    // Auto approval (REQUEST + AUTO_APPROVE + AUTO_APPROVE_MOVIE + AUTO_APPROVE_TV): 160

    const hasAutoApprove = (internalPermissions & 896) > 0; // Check for auto-approve permissions (128+256+512)

    return hasAutoApprove ? 160 : 32;
  }

  /**
   * Generate a secure password for service users
   */
  private generateSecurePassword(): string {
    return randomUUID() + randomUUID().replace(/-/g, '');
  }
}

// Export singleton instance
export const serviceUserManager = new ServiceUserManager();
