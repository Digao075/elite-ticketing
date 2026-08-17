import { SetMetadata } from '@nestjs/common';

export const STORED_USER_METADATA_KEY = 'requireStoredUser';

/**
 * Re-validates that the token subject still exists in PostgreSQL before the
 * handler runs. A correctly signed token for a deleted user is treated as
 * invalid rather than merely unauthorized for the role.
 */
export const RequireStoredUser = () => SetMetadata(STORED_USER_METADATA_KEY, true);
