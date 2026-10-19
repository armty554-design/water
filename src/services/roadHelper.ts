import { Member, DeliveryStop } from '../types/delivery';

// Known major road corridors and highways in the service area
const KNOWN_ROAD_CORRIDORS: { key: string; label: string; aliases: string[] }[] = [
  { key: 'สุวินทวงศ์', label: 'ถ.สุวินทวงศ์', aliases: ['สุวินทวงศ์', 'สุวิทวงศ์', '304'] },
  { key: 'หทัยราษฎร์', label: 'ถ.หทัยราษฎร์', aliases: ['หทัยราษฎร์', 'หทัยราษฎร'] },
  { key: 'นิมิตใหม่', label: 'ถ.นิมิตใหม่', aliases: ['นิมิตใหม่', 'นิมตรใหม่'] },
  { key: 'เชื่อมสัมพันธ์', label: 'ถ.เชื่อมสัมพันธ์', aliases: ['เชื่อมสัมพันธ์'] },
  { key: 'เลียบวารี', label: 'ถ.เลียบวารี', aliases: ['เลียบวารี'] },
  { key: 'ฉลองกรุง', label: 'ถ.ฉลองกรุง', aliases: ['ฉลองกรุง'] },
  { key: 'ร่มเกล้า', label: 'ถ.ร่มเกล้า', aliases: ['ร่มเกล้า'] },
  { key: 'รามอินทรา', label: 'ถ.รามอินทรา', aliases: ['รามอินทรา'] },
  { key: 'รามคำแหง', label: 'ถ.รามคำแหง', aliases: ['รามคำแหง', 'สุขาภิบาล 3'] },
  { key: 'เสรีไทย', label: 'ถ.เสรีไทย', aliases: ['เสรีไทย', 'สุขาภิบาล 2'] },
  { key: 'คู้บอน', label: 'ถ.คู้บอน', aliases: ['คู้บอน'] },
  { key: 'พระยาสุเรนทร์', label: 'ถ.พระยาสุเรนทร์', aliases: ['พระยาสุเรนทร์'] },
  { key: 'ปัญญาอินทรา', label: 'ถ.ปัญญาอินทรา', aliases: ['ปัญญาอินทรา', 'ปัญญารามอินทรา'] },
  { key: 'สามวา', label: 'ถ.สามวา', aliases: ['สามวา'] },
  { key: 'มิตรไมตรี', label: 'ถ.มิตรไมตรี', aliases: ['มิตรไมตรี'] },
  { key: 'ประชาร่วมใจ', label: 'ถ.ประชาร่วมใจ', aliases: ['ประชาร่วมใจ'] },
  { key: 'สังฆสันติสุข', label: 'ถ.สังฆสันติสุข', aliases: ['สังฆสันติสุข'] },
  { key: 'ลาดกระบัง', label: 'ถ.ลาดกระบัง', aliases: ['ลาดกระบัง', 'หลวงแพ่ง'] },
  { key: 'ประชาอุทิศ', label: 'ถ.ประชาอุทิศ', aliases: ['ประชาอุทิศ', 'ประชาพัฒนา'] },
  { key: 'สุขาภิบาล 5', label: 'ถ.สุขาภิบาล 5', aliases: ['สุขาภิบาล 5', 'สุขาภิบาล5'] },
  { key: 'สายไหม', label: 'ถ.สายไหม', aliases: ['สายไหม'] },
  { key: 'ลำลูกกา', label: 'ถ.ลำลูกกา', aliases: ['ลำลูกกา'] },
  { key: 'กาญจนาภิเษก', label: 'ถ.กาญจนาภิเษก', aliases: ['กาญจนาภิเษก', 'มอเตอร์เวย์', 'วงแหวน'] },
  { key: 'สาธุประดิษฐ์', label: 'ถ.สาธุประดิษฐ์', aliases: ['สาธุประดิษฐ์'] },
  { key: 'พระราม 4', label: 'ถ.พระราม 4', aliases: ['พระราม 4', 'พระราม4', 'พระรามสี่'] },
  { key: 'สาทร', label: 'ถ.สาทร', aliases: ['สาทร', 'สาทรใต้', 'สาทรเหนือ'] },
  { key: 'สีลม', label: 'ถ.สีลม', aliases: ['สีลม'] }
];

export interface AddressRoadInfo {
  road: string;
  roadKey: string;
  soi: string;
  soiNumber: number | null;
  parity: 'odd' | 'even' | 'none'; // 'odd' = ซอยเลขคี่, 'even' = ซอยเลขคู่
  village: string;
  subdistrict: string;
}

/**
 * Extracts structured road, soi, side/parity, and village information from Thai address strings.
 */
export function parseAddressRoadInfo(address?: string): AddressRoadInfo {
  if (!address || typeof address !== 'string') {
    return {
      road: '',
      roadKey: '',
      soi: '',
      soiNumber: null,
      parity: 'none',
      village: '',
      subdistrict: ''
    };
  }

  const cleanAddr = address.trim();

  // 1. Village / Estate
  const vMatch = cleanAddr.match(/(?:หมู่บ้าน|ม\.)\s*([ก-๙a-zA-Z0-9\s]+?)(?=\s+(?:ซ\.|ซอย|ม\.|หมู่|แขวง|ต\.|ตำบล|เขต|อ\.|อำเภอ|ถ\.|ถนน|\d)|$)/);
  const village = vMatch ? vMatch[1].trim() : '';

  // 2. Subdistrict (แขวง / ตำบล)
  const subMatch = cleanAddr.match(/(?:แขวง|ต\.|ตำบล)\s*([ก-๙a-zA-Z0-9]+)/);
  const subdistrict = subMatch ? subMatch[1].trim() : '';

  // 3. Known Road Matching
  let road = '';
  let roadKey = '';
  for (const item of KNOWN_ROAD_CORRIDORS) {
    if (item.aliases.some(alias => cleanAddr.includes(alias))) {
      road = item.label;
      roadKey = item.key;
      break;
    }
  }

  // Fallback road match via regex
  if (!road) {
    const rMatch = cleanAddr.match(/(?:ถ\.|ถนน)\s*([ก-๙a-zA-Z0-9]+)/);
    if (rMatch) {
      road = `ถ.${rMatch[1].trim()}`;
      roadKey = rMatch[1].trim();
    }
  }

  // 4. Soi & Parity (ซอยเลขคี่ / ซอยเลขคู่)
  const sMatch = cleanAddr.match(/(?:ซ\.|ซอย)\s*([ก-๙a-zA-Z0-9\/]+)/);
  let soi = sMatch ? sMatch[1].trim() : '';
  let soiNumber: number | null = null;
  let parity: 'odd' | 'even' | 'none' = 'none';

  if (soi) {
    const numMatch = soi.match(/(\d+)/);
    if (numMatch) {
      const num = parseInt(numMatch[1], 10);
      if (!isNaN(num)) {
        soiNumber = num;
        parity = (num % 2 === 0) ? 'even' : 'odd';
      }
    }
  }

  return {
    road,
    roadKey,
    soi,
    soiNumber,
    parity,
    village,
    subdistrict
  };
}

/**
 * Calculates Haversine distance in kilometers.
 */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates Road-Aware Effective Distance between two members:
 * - Rewards stops that belong to the same village/estate.
 * - Rewards stops on the same road and same side (odd vs even).
 * - Penalizes jumping across the road (odd vs even on divided highway) or crossing canal/unrelated zones.
 */
export function calculateRoadAwareDistance(m1: Member, m2: Member): number {
  const baseDist = calculateDistanceKm(m1.lat, m1.lng, m2.lat, m2.lng);
  if (baseDist >= 9000) return baseDist;

  const info1 = parseAddressRoadInfo(m1.address);
  const info2 = parseAddressRoadInfo(m2.address);

  // Same village / gated estate -> strong affinity!
  if (info1.village && info2.village && info1.village === info2.village) {
    return baseDist * 0.35;
  }

  // Same road corridor
  if (info1.roadKey && info2.roadKey && info1.roadKey === info2.roadKey) {
    // Both on same side of the road (e.g. both odd sois, or both even sois)
    if (info1.parity !== 'none' && info2.parity !== 'none') {
      if (info1.parity === info2.parity) {
        return baseDist * 0.65; // Same side: priority delivery!
      } else {
        // Different sides of the road (odd vs even across divider)
        // Add a virtual detour penalty (must finish one side before U-turn)
        return (baseDist + 1.2) * 1.8;
      }
    }
    return baseDist * 0.75; // Same road without specific soi
  }

  // Same subdistrict
  if (info1.subdistrict && info2.subdistrict && info1.subdistrict === info2.subdistrict) {
    return baseDist * 0.9;
  }

  return baseDist;
}

/**
 * Orders delivery stops along road corridors to prevent zigzagging across roads:
 * 1. Groups by road corridor / neighborhood.
 * 2. On divided roads, sequences stops along one side first (e.g. odd sois in progression),
 *    then transitions to the other side (even sois), minimizing U-turns and road crossings.
 */
export function sequenceStopsByRoadCorridor(stops: DeliveryStop[]): DeliveryStop[] {
  if (stops.length <= 1) return stops;

  const validStops = stops.filter(s => s.member.hasGps && s.member.lat && s.member.lng);
  const invalidStops = stops.filter(s => !s.member.hasGps || !s.member.lat || !s.member.lng);

  if (validStops.length <= 1) {
    return [...validStops, ...invalidStops].map((s, idx) => ({ ...s, sequence: idx + 1 }));
  }

  // Group valid stops into road corridors
  const corridorMap = new Map<string, DeliveryStop[]>();
  validStops.forEach(s => {
    const info = parseAddressRoadInfo(s.member.address);
    const key = info.roadKey || info.subdistrict || 'GENERAL';
    if (!corridorMap.has(key)) corridorMap.set(key, []);
    corridorMap.get(key)!.push(s);
  });

  // Sort stops inside each corridor along the road
  const sortedCorridors: DeliveryStop[][] = [];
  corridorMap.forEach((corridorStops, roadKey) => {
    if (corridorStops.length <= 1) {
      sortedCorridors.push(corridorStops);
      return;
    }

    // Separate into same-side clusters: Odd sois vs Even sois vs Others
    const oddStops: DeliveryStop[] = [];
    const evenStops: DeliveryStop[] = [];
    const generalStops: DeliveryStop[] = [];

    corridorStops.forEach(s => {
      const info = parseAddressRoadInfo(s.member.address);
      if (info.parity === 'odd') oddStops.push(s);
      else if (info.parity === 'even') evenStops.push(s);
      else generalStops.push(s);
    });

    // Helper: Nearest Neighbor chain within a group
    const chainByRoad = (group: DeliveryStop[], start?: DeliveryStop): DeliveryStop[] => {
      if (group.length <= 1) return [...group];
      const result: DeliveryStop[] = [];
      const pool = [...group];

      let current = start
        ? pool.splice(pool.indexOf(start) >= 0 ? pool.indexOf(start) : 0, 1)[0]
        : pool.shift()!;
      result.push(current);

      while (pool.length > 0) {
        let bestIdx = 0;
        let bestScore = Infinity;

        for (let i = 0; i < pool.length; i++) {
          const candidate = pool[i];
          const score = calculateRoadAwareDistance(current.member, candidate.member);
          if (score < bestScore) {
            bestScore = score;
            bestIdx = i;
          }
        }

        current = pool.splice(bestIdx, 1)[0];
        result.push(current);
      }

      return result;
    };

    // Chain each side separately to avoid jumping back and forth across the road
    const chainedOdd = chainByRoad(oddStops);
    const chainedEven = chainByRoad(evenStops);
    const chainedGeneral = chainByRoad(generalStops);

    // Combine in logical continuous sequence: Odd side -> General -> Even side (or vice versa)
    const combinedCorridor: DeliveryStop[] = [...chainedOdd, ...chainedGeneral, ...chainedEven];
    sortedCorridors.push(combinedCorridor);
  });

  // Chain corridors between each other to minimize overall transit distance
  const finalOrdered: DeliveryStop[] = [];
  const corridorPool = [...sortedCorridors];

  let currentCorridor = corridorPool.shift()!;
  finalOrdered.push(...currentCorridor);

  while (corridorPool.length > 0) {
    const lastStop = finalOrdered[finalOrdered.length - 1];
    let bestCorridorIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < corridorPool.length; i++) {
      const firstStop = corridorPool[i][0];
      const d = calculateDistanceKm(
        lastStop.member.lat,
        lastStop.member.lng,
        firstStop.member.lat,
        firstStop.member.lng
      );
      if (d < bestDist) {
        bestDist = d;
        bestCorridorIdx = i;
      }
    }

    const nextCorridor = corridorPool.splice(bestCorridorIdx, 1)[0];
    finalOrdered.push(...nextCorridor);
  }

  // Append any non-GPS stops at the end
  const allStops = [...finalOrdered, ...invalidStops];
  return allStops.map((s, idx) => ({
    ...s,
    sequence: idx + 1
  }));
}

// In-memory cache for OSRM routes to avoid duplicate network calls
const osrmRouteCache = new Map<string, { coordinates: [number, number][]; distanceKm: number; durationMinutes: number }>();

/**
 * Fetches real road driving geometry from OSRM public routing API.
 * Follows actual street curves and highway lanes, with automatic fallback to straight-line interpolation.
 */
export async function fetchRoadRoutePolyline(
  points: { lat: number; lng: number }[]
): Promise<{ coordinates: [number, number][]; distanceKm: number; durationMinutes: number }> {
  if (!points || points.length === 0) {
    return { coordinates: [], distanceKm: 0, durationMinutes: 0 };
  }

  if (points.length === 1) {
    return {
      coordinates: [[points[0].lat, points[0].lng]],
      distanceKm: 0,
      durationMinutes: 0
    };
  }

  // Construct cache key
  const cacheKey = points.map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';');
  if (osrmRouteCache.has(cacheKey)) {
    return osrmRouteCache.get(cacheKey)!;
  }

  // OSRM accepts max ~80 coordinates per request URL safely. If larger, chunk or sample.
  const sampledPoints = points.length > 60
    ? points.filter((_, idx) => idx === 0 || idx === points.length - 1 || idx % Math.ceil(points.length / 50) === 0)
    : points;

  const coordStr = sampledPoints.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?geometries=geojson&overview=full`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        // OSRM returns GeoJSON coordinates as [lng, lat]
        const latLngCoords: [number, number][] = route.geometry.coordinates.map(
          (c: [number, number]) => [c[1], c[0]]
        );
        const distanceKm = Math.round((route.distance / 1000) * 10) / 10;
        const durationMinutes = Math.round(route.duration / 60);

        const result = {
          coordinates: latLngCoords,
          distanceKm,
          durationMinutes
        };
        osrmRouteCache.set(cacheKey, result);
        return result;
      }
    }
  } catch (err) {
    // Graceful network or timeout fallback
  }

  // Fallback: connect points directly
  let totalDist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalDist += calculateDistanceKm(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
  }

  const fallbackResult = {
    coordinates: points.map(p => [p.lat, p.lng] as [number, number]),
    distanceKm: Math.round(totalDist * 10) / 10,
    durationMinutes: Math.round((totalDist / 30) * 60)
  };
  osrmRouteCache.set(cacheKey, fallbackResult);
  return fallbackResult;
}
