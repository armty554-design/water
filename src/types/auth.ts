import { UserRole } from './delivery';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  assignedTruck?: string; // If driver, locked to this truck
}

export interface LoginResponse {
  success: boolean;
  user?: AuthUser;
  error?: string;
}
