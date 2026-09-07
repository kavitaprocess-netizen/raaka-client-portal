// shared/timezone.js
//
// Availability, "today," and check-in windows must be computed in the
// BUSINESS's own timezone, not whoever's browser happens to be loading
// the page — a practitioner's "9 AM" is 9 AM where they actually
// operate, not 9 AM wherever a visiting client's laptop clock is set.
// Display of already-known appointment times doesn't need this — that
// already localizes correctly per viewer via standard timestamp
// formatting.
//
// Extracted here as the first shared module — previously duplicated,
// separately, across Client Portal, Staff Dashboard, and Owner
// Dashboard, which is exactly the kind of drift that let real bugs slip
// through in one copy while already fixed in another.

export let tenantTimezone = 'America/New_York'; // real value loaded at init from tenants.timezone

export function setTenantTimezone(tz) {
  if (tz) tenantTimezone = tz;
}

// Converts a wall-clock date/time as understood in a given IANA
// timezone into the correct, real UTC instant. Iterates once — a
// single-pass version was tested and found to give the wrong offset
// right at a DST transition boundary (confirmed directly: it was off
// by exactly one hour for a time shortly after a spring-forward), since
// the initial "treat wall-clock as if it were UTC" guess can land on
// the wrong side of the actual transition instant. Re-checking the
// offset at the first guess, rather than trusting the original guess's
// offset, converges to the correct answer even in that boundary case.
export function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const asIfUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  function offsetAt(instant) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(instant);
    const get = (type) => parseInt(parts.find(p => p.type === type).value, 10);
    const displayedAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return displayedAsUtc - instant.getTime();
  }
  const firstOffset = offsetAt(asIfUtc);
  const firstGuess = new Date(asIfUtc.getTime() - firstOffset);
  const secondOffset = offsetAt(firstGuess);
  return new Date(asIfUtc.getTime() - secondOffset);
}

// Reverse direction — for a real, absolute instant (e.g. an existing
// appointment's stored start_time, or "right now"), what date and
// minutes-since-midnight does that represent in a given timezone.
// Correctly handles the midnight boundary (verified directly: 3am UTC
// correctly reads as 11pm the PREVIOUS day in ET, not the naive
// UTC-date-slice answer of "today").
export function getDateAndMinutesInTimezone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(instant);
  const get = (type) => parts.find(p => p.type === type).value;
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    minutesOfDay: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10)
  };
}

export function getTodayDateKeyInTenantTimezone() {
  return getDateAndMinutesInTimezone(new Date(), tenantTimezone).dateKey;
}
