import { z } from "zod";
import type { AuthService } from "./auth/AuthService";
import type { DatabaseService } from "./database/DatabaseService";
import { FirebaseAuthService } from "./auth/FirebaseAuthService";
import { FirestoreService } from "./database/FirestoreService";

/**
 * Zod schema for Firestore Timestamp objects.
 * Validates the shape ({ seconds, nanoseconds }) without importing the Firestore SDK.
 */
const FirestoreTimestampSchema = z.object({
  seconds: z.number(),
  nanoseconds: z.number(),
});

/**
 * Athlete Profile schema matching Firestore 'private/profile' document
 */
export const AthleteProfileSchema = z.object({
  strava_athlete_id: z.number(),
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  profile_url: z.string().optional().nullable(),
  created_at: FirestoreTimestampSchema.optional().nullable(),
});

export type AthleteProfile = z.infer<typeof AthleteProfileSchema>;

export interface UserProfileServiceOptions {
  authService?: AuthService;
  databaseService?: DatabaseService;
}

/**
 * Service for fetching athlete profile data from Firestore
 */
export class UserProfileService {
  private authService: AuthService;
  private databaseService: DatabaseService;

  constructor(options?: UserProfileServiceOptions) {
    this.authService = options?.authService ?? new FirebaseAuthService();
    this.databaseService = options?.databaseService ?? new FirestoreService();
  }

  private getProfilePath(userId: string): string {
    return `users/${userId}/private/profile`;
  }

  /**
   * Get the athlete profile for the current user
   */
  async getProfile(): Promise<AthleteProfile | null> {
    const user = this.authService.getCurrentUser();
    if (!user) return null;

    try {
      return await this.databaseService.getDocument<AthleteProfile>(this.getProfilePath(user.uid), {
        schema: AthleteProfileSchema,
      });
    } catch (error) {
      console.error("Error fetching user profile:", error);
      return null;
    }
  }

  /**
   * Subscribe to athlete profile updates
   */
  subscribeToProfile(callback: (profile: AthleteProfile | null) => void): () => void {
    const user = this.authService.getCurrentUser();
    if (!user) {
      callback(null);
      return () => {};
    }

    return this.databaseService.subscribeToDocument<AthleteProfile>(
      this.getProfilePath(user.uid),
      callback,
      (error) => {
        console.error("Error in profile subscription:", error);
        callback(null);
      },
      { schema: AthleteProfileSchema }
    );
  }
}
