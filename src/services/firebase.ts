import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { 
  getFirestore, Firestore, doc, setDoc, getDoc, onSnapshot, 
  Unsubscribe, collection, getDocs, writeBatch 
} from 'firebase/firestore';
import { RouteAssignment, DeliveryStop, Member } from '../types/delivery';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

const STORAGE_KEY = 'water_app_firebase_config';

export const DEFAULT_FIREBASE_CONFIG: FirebaseConfig = {
  apiKey: "AIzaSyBX6tYWTVkOJ3fR2du-ResC7vcwhzrVzxw",
  authDomain: "water-delivery-14a16.firebaseapp.com",
  projectId: "water-delivery-14a16",
  storageBucket: "water-delivery-14a16.firebasestorage.app",
  messagingSenderId: "282230749909",
  appId: "1:282230749909:web:3cf276b27a4ea5496e405c",
  measurementId: "G-WWXY9GPHSZ"
};

/**
 * Get active Firebase configuration from environment, localStorage, or default
 */
export function getFirebaseConfig(): FirebaseConfig | null {
  // 1. Check environment variables (Vite / Vercel)
  if (import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID) {
    return {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.appspot.com`,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
      measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
    };
  }

  // 2. Check localStorage (custom user override)
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.apiKey && parsed.projectId) {
        return parsed;
      }
    } catch (e) {
      console.error('Failed to parse saved Firebase config', e);
    }
  }

  // 3. Built-in default project config
  return DEFAULT_FIREBASE_CONFIG;
}

export function saveFirebaseConfig(config: FirebaseConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  // Reinitialize app
  initFirebase();
}

export function clearFirebaseConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;

export function initFirebase(): { app: FirebaseApp | null; db: Firestore | null } {
  const config = getFirebaseConfig();
  if (!config) {
    appInstance = null;
    dbInstance = null;
    return { app: null, db: null };
  }

  try {
    if (getApps().length === 0) {
      appInstance = initializeApp(config);
    } else {
      appInstance = getApp();
    }
    dbInstance = getFirestore(appInstance);
    return { app: appInstance, db: dbInstance };
  } catch (err) {
    console.error('Firebase initialization error:', err);
    return { app: null, db: null };
  }
}

export function getFirebaseDb(): Firestore | null {
  if (!dbInstance) {
    const { db } = initFirebase();
    return db;
  }
  return dbInstance;
}

export function isFirebaseConfigured(): boolean {
  return getFirebaseConfig() !== null;
}

// -------------------------------------------------------------
// Cloud Firestore Data Operations (Routes, Stops & Real-time Sync)
// -------------------------------------------------------------

/**
 * Save route assignment to Firestore
 */
export async function saveRouteToCloud(assignment: RouteAssignment): Promise<boolean> {
  const db = getFirebaseDb();
  if (!db) return false;

  const docId = `${assignment.truckNo}_${assignment.dateKey || assignment.day}`;
  const routeRef = doc(db, 'routes', docId);

  await setDoc(routeRef, {
    ...assignment,
    updatedAt: new Date().toISOString()
  });

  return true;
}

/**
 * Get route assignment from Firestore
 */
export async function getRouteFromCloud(truckNo: string, dateKey: string): Promise<RouteAssignment | null> {
  const db = getFirebaseDb();
  if (!db) return null;

  const docId = `${truckNo}_${dateKey}`;
  const routeRef = doc(db, 'routes', docId);
  const snap = await getDoc(routeRef);

  if (snap.exists()) {
    return snap.data() as RouteAssignment;
  }
  return null;
}

/**
 * Real-time listener for route changes (e.g. Office moves stops, Driver marks complete)
 */
export function subscribeToRouteCloud(
  truckNo: string,
  dateKey: string,
  onUpdate: (route: RouteAssignment | null) => void
): Unsubscribe | null {
  const db = getFirebaseDb();
  if (!db) return null;

  const docId = `${truckNo}_${dateKey}`;
  const routeRef = doc(db, 'routes', docId);

  return onSnapshot(routeRef, (snap) => {
    if (snap.exists()) {
      onUpdate(snap.data() as RouteAssignment);
    } else {
      onUpdate(null);
    }
  }, (err) => {
    console.warn('Firestore route subscription error:', err);
  });
}

/**
 * Mark a stop as completed directly in Firestore
 */
export async function markStopCompletedInCloud(
  truckNo: string,
  dateKey: string,
  memberId: string,
  isCompleted: boolean
): Promise<boolean> {
  const db = getFirebaseDb();
  if (!db) return false;

  const docId = `${truckNo}_${dateKey}`;
  const routeRef = doc(db, 'routes', docId);
  const snap = await getDoc(routeRef);

  if (!snap.exists()) return false;

  const data = snap.data() as RouteAssignment;
  const updatedStops = (data.stops || []).map((s: DeliveryStop) => {
    if (s.member.id === memberId) {
      return {
        ...s,
        isCompleted,
        completedAt: isCompleted ? new Date().toISOString() : undefined
      };
    }
    return s;
  });

  await setDoc(routeRef, {
    ...data,
    stops: updatedStops,
    updatedAt: new Date().toISOString()
  });

  return true;
}

/**
 * Partition and save members to Firestore by truck number.
 * This keeps document sizes small (~30KB per truck) and optimizes free tier reads.
 */
export async function saveMembersToCloud(members: Member[]): Promise<boolean> {
  const db = getFirebaseDb();
  if (!db) return false;

  // Group members by truckNo
  const truckGroups: Record<string, Member[]> = {};
  members.forEach(m => {
    const truck = m.truckNo || 'UNASSIGNED';
    if (!truckGroups[truck]) truckGroups[truck] = [];
    truckGroups[truck].push(m);
  });

  const batch = writeBatch(db);
  for (const [truckNo, memberList] of Object.entries(truckGroups)) {
    const ref = doc(db, 'truck_members', truckNo);
    batch.set(ref, {
      truckNo,
      members: memberList,
      count: memberList.length,
      updatedAt: new Date().toISOString()
    });
  }

  // Also save a lightweight metadata summary
  const metaRef = doc(db, 'system', 'meta');
  batch.set(metaRef, {
    totalMembers: members.length,
    trucksCount: Object.keys(truckGroups).length,
    updatedAt: new Date().toISOString()
  });

  await batch.commit();
  return true;
}

/**
 * Fetch all members from Firestore
 */
export async function getMembersFromCloud(): Promise<Member[] | null> {
  const db = getFirebaseDb();
  if (!db) return null;

  try {
    const colRef = collection(db, 'truck_members');
    const snap = await getDocs(colRef);
    if (snap.empty) return null;

    const allMembers: Member[] = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (Array.isArray(data.members)) {
        allMembers.push(...data.members);
      }
    });

    return allMembers;
  } catch (err) {
    console.error('Failed to get members from Cloud:', err);
    return null;
  }
}
