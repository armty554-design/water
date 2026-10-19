import { DeliveryStop, DayOfWeek } from '../types/delivery';
import { calculateRoadAwareDistance, sequenceStopsByRoadCorridor } from './roadHelper';

// Calculate Haversine distance between two coordinates in kilometers
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export { sequenceStopsByRoadCorridor };

export type AutoSequenceMode = 'historical' | 'timewindow' | 'gps' | 'road';

export function autoSequenceStops(
  stops: DeliveryStop[],
  mode: AutoSequenceMode,
  day: DayOfWeek
): DeliveryStop[] {
  if (stops.length <= 1) return stops;

  const stopsCopy = [...stops];

  if (mode === 'historical') {
    // 1. Sort by historical actual arrival time average
    stopsCopy.sort((a, b) => {
      const aTime = a.daySchedule?.avgActualTimeMinutes ?? 9999;
      const bTime = b.daySchedule?.avgActualTimeMinutes ?? 9999;
      if (aTime !== bTime) return aTime - bTime;
      return a.member.id.localeCompare(b.member.id);
    });
  } else if (mode === 'timewindow') {
    // 2. Sort by time window start time
    const getStartTime = (stop: DeliveryStop): number => {
      const tw = stop.daySchedule?.timeWindow;
      if (tw) {
        const match = tw.match(/^(\d{1,2}):(\d{2})/);
        if (match) return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
      }
      if (stop.member.targetTime) {
        const num = parseInt(stop.member.targetTime, 10);
        if (!isNaN(num) && num > 0) {
          const h = Math.floor(num / 100);
          const m = num % 100;
          return h * 60 + m;
        }
      }
      return 9999;
    };

    stopsCopy.sort((a, b) => {
      const aTime = getStartTime(a);
      const bTime = getStartTime(b);
      if (aTime !== bTime) return aTime - bTime;
      return a.member.id.localeCompare(b.member.id);
    });
  } else if (mode === 'road') {
    // 3. Road Corridor Sequence (minimizes road crossing & U-turns)
    return sequenceStopsByRoadCorridor(stopsCopy);
  } else if (mode === 'gps') {
    // 4. Smart Road-Aware GPS Route (Nearest Neighbor with time window buckets & road corridor)
    // First, divide into Morning (< 12:00) and Afternoon (>= 12:00)
    const morning: DeliveryStop[] = [];
    const afternoon: DeliveryStop[] = [];
    const anytime: DeliveryStop[] = [];

    stopsCopy.forEach(stop => {
      const time = stop.daySchedule?.avgActualTimeMinutes;
      if (time !== undefined && time < 720) {
        morning.push(stop);
      } else if (time !== undefined && time >= 720) {
        afternoon.push(stop);
      } else {
        anytime.push(stop);
      }
    });

    const optimizeGroup = (group: DeliveryStop[], startLat?: number, startLng?: number): DeliveryStop[] => {
      if (group.length <= 1) return group;
      const result: DeliveryStop[] = [];
      const remaining = [...group];

      // Pick start point (either closest to startLat/Lng or the first one with valid GPS)
      let currentIdx = 0;
      if (startLat !== undefined && startLng !== undefined) {
        let minD = Infinity;
        remaining.forEach((s, idx) => {
          if (s.member.hasGps) {
            const d = calculateDistanceKm(startLat, startLng, s.member.lat, s.member.lng);
            if (d < minD) {
              minD = d;
              currentIdx = idx;
            }
          }
        });
      }

      let current = remaining.splice(currentIdx, 1)[0];
      result.push(current);

      while (remaining.length > 0) {
        if (!current.member.hasGps) {
          current = remaining.shift()!;
          result.push(current);
          continue;
        }

        let nearestIdx = 0;
        let nearestDist = Infinity;

        for (let i = 0; i < remaining.length; i++) {
          const candidate = remaining[i];
          if (candidate.member.hasGps) {
            // Use road-aware distance to avoid jumping across divided roads/canals
            const dist = calculateRoadAwareDistance(current.member, candidate.member);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestIdx = i;
            }
          }
        }

        current = remaining.splice(nearestIdx, 1)[0];
        result.push(current);
      }

      return result;
    };

    const optMorning = optimizeGroup(morning);
    const lastMorning = optMorning[optMorning.length - 1];
    const optAnytime = optimizeGroup(anytime, lastMorning?.member?.lat, lastMorning?.member?.lng);
    const lastAnytime = optAnytime[optAnytime.length - 1] || lastMorning;
    const optAfternoon = optimizeGroup(afternoon, lastAnytime?.member?.lat, lastAnytime?.member?.lng);

    const merged = [...optMorning, ...optAnytime, ...optAfternoon];
    return merged.map((stop, idx) => ({
      ...stop,
      sequence: idx + 1
    }));
  }

  // Renumber sequences 1..N
  return stopsCopy.map((stop, index) => ({
    ...stop,
    sequence: index + 1
  }));
}
