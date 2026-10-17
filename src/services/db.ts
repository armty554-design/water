import { get, set, update } from 'idb-keyval';
import { Member, RouteAssignment, DayOfWeek, DeliveryStop, Attachment } from '../types/delivery';

const MEMBERS_KEY = 'water_app_members';
const ROUTES_KEY = 'water_app_routes';
const ATTACHMENTS_KEY = 'water_app_attachments';
const LAST_TRUCK_KEY = 'water_app_last_truck';

export async function saveMembers(members: Member[]): Promise<void> {
  await set(MEMBERS_KEY, members);
}

export async function getMembers(): Promise<Member[]> {
  const data = await get<Member[]>(MEMBERS_KEY);
  return data || [];
}

export async function updateSingleMember(memberId: string, partial: Partial<Member>): Promise<void> {
  await update<Member[]>(MEMBERS_KEY, (prev) => {
    if (!prev) return [];
    return prev.map(m => m.id === memberId ? { ...m, ...partial } : m);
  });
}

export function getRouteKey(truckNo: string, day: DayOfWeek): string {
  return `${truckNo}_${day}`;
}

export async function saveRoute(truckNo: string, day: DayOfWeek, stops: DeliveryStop[]): Promise<void> {
  const key = getRouteKey(truckNo, day);
  const routes = (await get<Record<string, RouteAssignment>>(ROUTES_KEY)) || {};
  routes[key] = {
    truckNo,
    day,
    dateKey: new Date().toISOString().slice(0, 10),
    stops,
    updatedAt: new Date().toISOString()
  };
  await set(ROUTES_KEY, routes);
}

export async function getRoute(truckNo: string, day: DayOfWeek): Promise<RouteAssignment | null> {
  const key = getRouteKey(truckNo, day);
  const routes = (await get<Record<string, RouteAssignment>>(ROUTES_KEY)) || {};
  return routes[key] || null;
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
  notes?: string
): Promise<void> {
  const route = await getRoute(truckNo, day);
  if (!route) return;

  const updatedStops = route.stops.map(s => {
    if (s.member.id === memberId) {
      return {
        ...s,
        isCompleted,
        completedAt: isCompleted ? new Date().toISOString() : undefined,
        notes: notes !== undefined ? notes : s.notes
      };
    }
    return s;
  });

  await saveRoute(truckNo, day, updatedStops);
}

export async function addAttachment(memberId: string, attachment: Attachment): Promise<void> {
  const allAtt = (await get<Record<string, Attachment[]>>(ATTACHMENTS_KEY)) || {};
  if (!allAtt[memberId]) {
    allAtt[memberId] = [];
  }
  allAtt[memberId].unshift(attachment);
  await set(ATTACHMENTS_KEY, allAtt);

  // Also update in member list
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
