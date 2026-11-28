import { get, set, update } from 'idb-keyval';
import { Member, RouteAssignment, DayOfWeek, DeliveryStop, Attachment } from '../types/delivery';
import { 
  saveRouteToCloud, getRouteFromCloud, markStopCompletedInCloud, 
  saveMembersToCloud, getMembersFromCloud, subscribeToRouteCloud,
  clearAllCloudData, getCloudMeta, getTruckMembersFromCloud,
  getGlobalSearchIndexFromCloud, CloudMeta, MemberSearchIndexEntry, isFirebaseConfigured 
} from './firebase';

const MEMBERS_KEY = 'water_app_members';
const ROUTES_KEY = 'water_app_routes';
const ATTACHMENTS_KEY = 'water_app_attachments';
const LAST_TRUCK_KEY = 'water_app_last_truck';
const CLOUD_META_KEY = 'water_app_cloud_meta';
const SEARCH_INDEX_KEY = 'water_app_search_index';
const SEARCH_INDEX_UPDATED_KEY = 'water_app_search_index_updated';

export async function getOrLoadGlobalSearchIndex(cloudMeta: CloudMeta | null): Promise<MemberSearchIndexEntry[] | null> {
  if (!cloudMeta?.indexChunks || cloudMeta.indexChunks <= 0) return null;

  const cachedUpdated = await get<string>(SEARCH_INDEX_UPDATED_KEY);
  const cachedIndex = await get<MemberSearchIndexEntry[]>(SEARCH_INDEX_KEY);
  if (cachedIndex && cachedIndex.length > 0 && cachedUpdated === (cloudMeta.indexUpdatedAt || cloudMeta.updatedAt)) {
    return cachedIndex;
  }

  const fetched = await getGlobalSearchIndexFromCloud(cloudMeta.indexChunks);
  if (fetched.length > 0) {
    await set(SEARCH_INDEX_KEY, fetched);
    await set(SEARCH_INDEX_UPDATED_KEY, cloudMeta.indexUpdatedAt || cloudMeta.updatedAt);
  }
  return fetched;
}

export async function getLocalMembers(): Promise<Member[]> {
  return (await get<Member[]>(MEMBERS_KEY)) || [];
}

export async function saveLocalMembers(members: Member[]): Promise<void> {
  await set(MEMBERS_KEY, members);
}

export async function getLocalCloudMeta(): Promise<CloudMeta | null> {
  return (await get<CloudMeta>(CLOUD_META_KEY)) || null;
}

export async function saveLocalCloudMeta(meta: CloudMeta | null): Promise<void> {
  await set(CLOUD_META_KEY, meta);
}

export async function clearAllData(): Promise<void> {
  await set(MEMBERS_KEY, []);
  await set(ROUTES_KEY, {});
  await set(ATTACHMENTS_KEY, {});
  await set(CLOUD_META_KEY, null);
  if (isFirebaseConfigured()) {
    await clearAllCloudData().catch(err => {
      console.warn('Cloud clearAllData failed:', err);
    });
  }
}

export async function saveMembers(members: Member[]): Promise<void> {
  // 1. Save to local IndexedDB (fast instant response)
  await set(MEMBERS_KEY, members);

  // 2. Sync to Firebase Cloud if configured
  if (isFirebaseConfigured()) {
    saveMembersToCloud(members).catch(err => {
      console.warn('Background sync to Cloud failed:', err);
    });
  }
}

export async function getMembers(): Promise<Member[]> {
  // 1. If Firebase is configured, try fetching latest from Cloud
  if (isFirebaseConfigured()) {
    try {
      const cloudMembers = await getMembersFromCloud();
      if (cloudMembers && cloudMembers.length > 0) {
        // Cache to local IndexedDB
        await set(MEMBERS_KEY, cloudMembers);
        return cloudMembers;
      }
    } catch (e) {
      console.warn('Failed to load members from cloud, fallback to local:', e);
    }
  }

  // 2. Fallback to local IndexedDB
  const data = await get<Member[]>(MEMBERS_KEY);
  return data || [];
}

export async function updateSingleMember(memberId: string, partial: Partial<Member>): Promise<void> {
  await update<Member[]>(MEMBERS_KEY, (prev) => {
    if (!prev) return [];
    return prev.map(m => m.id === memberId ? { ...m, ...partial } : m);
  });
}

export function getRouteKey(truckNo: string, dayOrDate: string): string {
  return `${truckNo}_${dayOrDate}`;
}

export async function saveRoute(
  truckNo: string,
  day: DayOfWeek,
  stops: DeliveryStop[],
  dateKey?: string
): Promise<void> {
  const actualDate = dateKey || new Date().toISOString().slice(0, 10);
  const routes = (await get<Record<string, RouteAssignment>>(ROUTES_KEY)) || {};
  
  const assignment: RouteAssignment = {
    truckNo,
    day,
    dateKey: actualDate,
    stops,
    updatedAt: new Date().toISOString()
  };

  // 1. Save locally to IndexedDB
  routes[`${truckNo}_${actualDate}`] = assignment;
  routes[`${truckNo}_${day}`] = assignment;
  await set(ROUTES_KEY, routes);

  // 2. Save to Firebase Cloud Firestore for real-time driver sync
  if (isFirebaseConfigured()) {
    saveRouteToCloud(assignment).catch(err => {
      console.warn('Cloud saveRoute error:', err);
    });
  }
}

export async function getRoute(
  truckNo: string,
  day: DayOfWeek,
  dateKey?: string
): Promise<RouteAssignment | null> {
  const actualDate = dateKey || new Date().toISOString().slice(0, 10);

  // 1. If Firebase is configured, try getting latest route from Cloud
  if (isFirebaseConfigured()) {
    try {
      const cloudRoute = await getRouteFromCloud(truckNo, actualDate);
      if (cloudRoute) {
        // Cache locally
        const routes = (await get<Record<string, RouteAssignment>>(ROUTES_KEY)) || {};
        routes[`${truckNo}_${actualDate}`] = cloudRoute;
        routes[`${truckNo}_${day}`] = cloudRoute;
        await set(ROUTES_KEY, routes);
        return cloudRoute;
      }
    } catch (e) {
      console.warn('Failed to getRoute from Cloud, using local cache:', e);
    }
  }

  // 2. Fallback to local cache
  const routes = (await get<Record<string, RouteAssignment>>(ROUTES_KEY)) || {};
  if (dateKey && routes[`${truckNo}_${dateKey}`]) {
    return routes[`${truckNo}_${dateKey}`];
  }
  return routes[`${truckNo}_${day}`] || null;
}

export async function getAllRoutes(): Promise<Record<string, RouteAssignment>> {
  const routes = await get<Record<string, RouteAssignment>>(ROUTES_KEY);
  return routes || {};
}

export async function markStopCompleted(
  truckNo: string,
  day: DayOfWeek,
  memberId: string,
  isCompleted: boolean,
  dateKey?: string
): Promise<void> {
  const actualDate = dateKey || new Date().toISOString().slice(0, 10);
  const route = await getRoute(truckNo, day, actualDate);
  if (!route) return;

  const updatedStops = route.stops.map(s => {
    if (s.member.id === memberId) {
      return {
        ...s,
        isCompleted,
        completedAt: isCompleted ? new Date().toISOString() : undefined
      };
    }
    return s;
  });

  // Save both locally and to Cloud
  await saveRoute(truckNo, day, updatedStops, actualDate);

  // Direct fast cloud update
  if (isFirebaseConfigured()) {
    markStopCompletedInCloud(truckNo, actualDate, memberId, isCompleted).catch(err => {
      console.warn('Cloud markStopCompleted error:', err);
    });
  }
}

export async function addAttachment(memberId: string, attachment: Attachment): Promise<void> {
  const allAtt = (await get<Record<string, Attachment[]>>(ATTACHMENTS_KEY)) || {};
  if (!allAtt[memberId]) {
    allAtt[memberId] = [];
  }
  allAtt[memberId].unshift(attachment);
  await set(ATTACHMENTS_KEY, allAtt);

  await update<Member[]>(MEMBERS_KEY, (prev) => {
    if (!prev) return [];
    return prev.map(m => {
      if (m.id === memberId) {
        const list = m.attachments || [];
        return { ...m, attachments: [attachment, ...list] };
      }
      return m;
    });
  });
}

export async function getAttachments(memberId: string): Promise<Attachment[]> {
  const allAtt = (await get<Record<string, Attachment[]>>(ATTACHMENTS_KEY)) || {};
  return allAtt[memberId] || [];
}

export async function saveLastTruck(truckNo: string): Promise<void> {
  await set(LAST_TRUCK_KEY, truckNo);
}

export async function getLastTruck(): Promise<string | null> {
  return (await get<string>(LAST_TRUCK_KEY)) || null;
}

export { subscribeToRouteCloud, isFirebaseConfigured, getCloudMeta, getTruckMembersFromCloud };
export type { CloudMeta, MemberSearchIndexEntry };
