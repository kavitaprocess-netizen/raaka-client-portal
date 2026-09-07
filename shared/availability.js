// shared/availability.js
//
// Real availability computation — extracted from Client Portal, where
// this logic was originally built and carefully tested against real
// edge cases (DST transition boundaries, midnight-boundary appointments,
// exact back-to-back non-overlapping bookings, per-service lead time and
// buffer). Now shared so a new staff-facing "book for a client" flow
// uses the exact same real logic, rather than a second, separately-
// maintained copy that could quietly drift out of sync.
//
// A factory function, same pattern as calendar.js — needs the Supabase
// client and the shared timezone module's functions, which differ by
// host file (pilotClient vs a dashboard's own client instance).

export function createAvailabilityModule(config) {
  const { getClient, getDateAndMinutesInTimezone, getTenantTimezone } = config;

  async function loadRealAvailabilityForPractitioner(practitionerId) {
    const client = getClient();

    const { data: avail, error: availErr } = await client
      .from('practitioner_availability').select('*').eq('practitioner_id', practitionerId);
    if (availErr) return { error: availErr.message };

    const { data: timeOff, error: toErr } = await client
      .from('practitioner_time_off').select('date').eq('practitioner_id', practitionerId);
    if (toErr) return { error: toErr.message };

    // service_id included — needed to look up each existing
    // appointment's own buffer_minutes when computing whether a
    // candidate slot respects the required gap after it.
    const { data: appts, error: apptErr } = await client
      .from('appointments').select('start_time, end_time, service_id')
      .eq('practitioner_id', practitionerId).neq('status', 'cancelled');
    if (apptErr) return { error: apptErr.message };

    // Tenant-wide, not practitioner-specific — every service's buffer
    // setting, so an existing appointment's buffer can be looked up
    // regardless of which service it was for.
    const { data: allServices } = await client.from('services').select('id, buffer_minutes');
    const serviceBufferMinutesById = {};
    (allServices || []).forEach(s => { serviceBufferMinutesById[s.id] = s.buffer_minutes || 0; });

    return {
      availability: avail || [],
      timeOffDates: (timeOff || []).map(t => t.date),
      existingAppointments: appts || [],
      serviceBufferMinutesById,
    };
  }

  // Pure function, no backend calls — identical logic to the original,
  // already-verified version (closed days, time-off dates, exact
  // back-to-back non-overlapping bookings, past-time filtering for
  // today, DST transition boundaries).
  function computeAvailableSlots(dateISO, dayOfWeek, availability, timeOffDates, existingAppointments, durationMinutes, nowDate, minLeadTimeMinutes, bufferMinutesLookup) {
    const dayAvail = availability.find(a => a.day_of_week === dayOfWeek);
    if (!dayAvail || !dayAvail.is_open) return [];
    if (timeOffDates.includes(dateISO)) return [];

    const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
    const openStart = toMinutes(dayAvail.start_time);
    const openEnd = toMinutes(dayAvail.end_time);
    const tenantTimezone = getTenantTimezone();

    // Existing appointments are real, absolute timestamps —
    // interpreting them with plain .getHours()/.getMinutes() would use
    // the BROWSER's local timezone, not the tenant's. Each busy range's
    // end is extended by THAT appointment's own service's buffer time —
    // the gap needed is a property of what just happened, not of what's
    // being booked next.
    const busyRanges = existingAppointments
      .filter(a => getDateAndMinutesInTimezone(new Date(a.start_time), tenantTimezone).dateKey === dateISO)
      .map(a => {
        const s = getDateAndMinutesInTimezone(new Date(a.start_time), tenantTimezone).minutesOfDay;
        const e = getDateAndMinutesInTimezone(new Date(a.end_time), tenantTimezone).minutesOfDay;
        const buffer = (bufferMinutesLookup && a.service_id && bufferMinutesLookup[a.service_id]) || 0;
        return [s, e + buffer];
      });

    const slots = [];
    const stepMinutes = 30;
    const nowInTenantTz = nowDate ? getDateAndMinutesInTimezone(nowDate, tenantTimezone) : null;
    for (let start = openStart; start + durationMinutes <= openEnd; start += stepMinutes) {
      const end = start + durationMinutes;
      if (busyRanges.some(([bs, be]) => start < be && end > bs)) continue;
      if (nowInTenantTz && dateISO === nowInTenantTz.dateKey) {
        const leadMinutes = minLeadTimeMinutes || 0;
        if (start <= nowInTenantTz.minutesOfDay + leadMinutes) continue;
      }
      const h24 = Math.floor(start / 60), m = start % 60;
      const period = h24 >= 12 ? 'PM' : 'AM';
      const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
      slots.push(`${h12}:${m.toString().padStart(2, '0')} ${period}`);
    }
    return slots;
  }

  return { loadRealAvailabilityForPractitioner, computeAvailableSlots };
}
