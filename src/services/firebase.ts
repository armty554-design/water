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

/**
 * Recursively remove all undefined values and delete undefined keys
 * so Firestore accepts the data without throwing "Unsupported field value: undefined".
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as any;
  }
  return JSON.parse(JSON.stringify(data));
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

  const docId = `${assignment.truckNo}_${assignment.dateKey || assignment.day}`.replace(/\//g, '_');
  const routeRef = doc(db, 'routes', docId);

  const payload = sanitizeForFirestore({
    ...assignment,
    updatedAt: new Date().toISOString()
  });

  await setDoc(routeRef, payload);
  return true;
}

/**
 * Get route assignment from Firestore
 */
export async function getRouteFromCloud(truckNo: string, dateKey: string): Promise<RouteAssignment | null> {
  const db = getFirebaseDb();
  if (!db) return null;

  const docId = `${truckNo}_${dateKey}`.replace(/\//g, '_');
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

  const docId = `${truckNo}_${dateKey}`.replace(/\//g, '_');
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

  const docId = `${truckNo}_${dateKey}`.replace(/\//g, '_');
  const routeRef = doc(db, 'routes', docId);
  const snap = await getDoc(routeRef);

  if (!snap.exists()) return false;

  const data = snap.data() as RouteAssignment;
  const updatedStops = (data.stops || []).map((s: DeliveryStop) => {
    if (s.member.id === memberId) {
      const stopUpdate: DeliveryStop = {
        ...s,
        isCompleted
      };
      if (isCompleted) {
        stopUpdate.completedAt = new Date().toISOString();
      } else {
        delete stopUpdate.completedAt;
      }
      return stopUpdate;
    }
    return s;
  });

  const payload = sanitizeForFirestore({
    ...data,
    stops: updatedStops,
    updatedAt: new Date().toISOString()
  });

  await setDoc(routeRef, payload);
  return true;
}

export interface CloudTruckSummary {
  truckNo: string;
  count: number;
}

export interface CloudMeta {
  totalMembers: number;
  trucksCount: number;
  trucks?: CloudTruckSummary[];
  sourceFile?: string;
  updatedAt: string;
}

/**
 * Fetch lightweight system metadata (~8KB) including list of all trucks and total counts
 */
export async function getCloudMeta(): Promise<CloudMeta | null> {
  const db = getFirebaseDb();
  if (!db) return null;

  try {
    const snap = await getDoc(doc(db, 'system', 'meta'));
    return snap.exists() ? (snap.data() as CloudMeta) : null;
  } catch (err) {
    console.warn('Failed to get Cloud meta:', err);
    return null;
  }
}

/**
 * Fetch members for a single truck from Firestore (~100-750 records, fast single-doc read)
 */
export async function getTruckMembersFromCloud(truckNo: string): Promise<Member[]> {
  const db = getFirebaseDb();
  if (!db || !truckNo) return [];

  const docId = truckNo.trim().replace(/\//g, '_') || 'UNASSIGNED';
  try {
    const snap = await getDoc(doc(db, 'truck_members', docId));
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data.members)) {
        return data.members as Member[];
      }
    }
    return [];
  } catch (err) {
    console.warn(`Failed to get members for truck ${docId}:`, err);
    return [];
  }
}

/**
 * Partition and save members to Firestore by truck number.
 * Uses metadata index to remove stale trucks without downloading all 60MB+ docs.
 */
export async function saveMembersToCloud(
  members: Member[],
  onProgress?: (currentTrucks: number, totalTrucks: number) => void
): Promise<boolean> {
  const db = getFirebaseDb();
  if (!db) return false;

  // Group members by truckNo
  const truckGroups: Record<string, Member[]> = {};
  members.forEach(m => {
    const rawTruck = m.truckNo ? String(m.truckNo).trim() : 'UNASSIGNED';
    const truck = rawTruck.replace(/\//g, '_') || 'UNASSIGNED';
    if (!truckGroups[truck]) truckGroups[truck] = [];
    truckGroups[truck].push(m);
  });

  const entries = Object.entries(truckGroups);
  const activeTruckSet = new Set(entries.map(([truckNo]) => truckNo));

  // Remove stale truck_members docs using metadata index (avoids heavy full-collection stream)
  try {
    const oldMeta = await getCloudMeta();
    const oldTruckIds = oldMeta?.trucks?.map(t => t.truckNo.replace(/\//g, '_')) || [];
    const staleIds = oldTruckIds.filter(id => !activeTruckSet.has(id));
    for (let i = 0; i < staleIds.length; i += 400) {
      const delBatch = writeBatch(db);
      staleIds.slice(i, i + 400).forEach(id => delBatch.delete(doc(db, 'truck_members', id)));
      await delBatch.commit();
    }
  } catch (cleanupErr) {
    console.warn('Could not clean stale truck_members docs:', cleanupErr);
  }

  const CHUNK_SIZE = 5; // Keep batch payload comfortably under Firestore limits
  let completedCount = 0;
  const nowIso = new Date().toISOString();

  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);

    for (const [truckNo, memberList] of chunk) {
      const ref = doc(db, 'truck_members', truckNo);
      const payload = sanitizeForFirestore({
        truckNo,
        members: memberList,
        count: memberList.length,
        updatedAt: nowIso
      });
      batch.set(ref, payload);
    }

    await batch.commit();
    completedCount += chunk.length;
    if (onProgress) {
      onProgress(completedCount, entries.length);
    }
  }

  // Save lightweight metadata summary + truck index
  const trucksSummary: CloudTruckSummary[] = entries
    .map(([truckNo, memberList]) => ({ truckNo, count: memberList.length }))
    .sort((a, b) => b.count - a.count);

  const metaRef = doc(db, 'system', 'meta');
  await setDoc(metaRef, sanitizeForFirestore({
    totalMembers: members.length,
    trucksCount: entries.length,
    trucks: trucksSummary,
    updatedAt: nowIso
  }));

  return true;
}

/**
 * Delete all existing cloud member and route documents before uploading a fresh dataset
 */
export async function clearAllCloudData(): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;

  const meta = await getCloudMeta();
  if (meta?.trucks && meta.trucks.length > 0) {
    const truckIds = meta.trucks.map(t => t.truckNo.replace(/\//g, '_'));
    for (let i = 0; i < truckIds.length; i += 400) {
      const batch = writeBatch(db);
      truckIds.slice(i, i + 400).forEach(id => batch.delete(doc(db, 'truck_members', id)));
      await batch.commit();
    }
  } else {
    const tmSnap = await getDocs(collection(db, 'truck_members'));
    for (let i = 0; i < tmSnap.docs.length; i += 400) {
      const batch = writeBatch(db);
      tmSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  }

  const rtSnap = await getDocs(collection(db, 'routes'));
  for (let i = 0; i < rtSnap.docs.length; i += 400) {
    const batch = writeBatch(db);
    rtSnap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

/**
 * Fetch all members from Firestore in batched single-doc reads (avoids Listen stream quota spikes)
 */
export async function getMembersFromCloud(): Promise<Member[] | null> {
  const db = getFirebaseDb();
  if (!db) return null;

  try {
    const meta = await getCloudMeta();
    if (meta?.trucks && meta.trucks.length > 0) {
      const allMembers: Member[] = [];
      const BATCH_SIZE = 15;
      for (let i = 0; i < meta.trucks.length; i += BATCH_SIZE) {
        const chunk = meta.trucks.slice(i, i + BATCH_SIZE);
        const docs = await Promise.all(
          chunk.map(t => getTruckMembersFromCloud(t.truckNo))
        );
        docs.forEach(list => allMembers.push(...list));
      }
      return allMembers;
    }

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
