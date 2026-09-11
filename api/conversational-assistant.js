// Vercel serverless function — POST /api/conversational-assistant
//
// A real conversational front-desk assistant for Client Portal — booking
// and gift card purchases, replacing the original AI-driven-Q&A decision
// with something genuinely "smarter": free-text understanding, real live
// availability checked mid-conversation (not simulated), returning-client
// memory, and casual date/time language resolved against the real
// calendar rather than guessed at.
//
// Deliberately does NOT execute the actual booking or gift-card purchase
// itself. When the conversation reaches a clear, confirmed decision, it
// signals that back to the frontend, which hands off to the EXACT SAME
// existing, already-tested booking/purchase screens (pre-filled) for the
// person to review and confirm themselves — reusing all the real payment,
// credit-usage, and account logic already in Client Portal rather than
// risking a second, separately-maintained transactional path that could
// drift out of sync or mishandle an edge case those screens already
// handle correctly.
//
// Zero npm dependencies — plain fetch() calls only, same proven pattern
// as summarize-transcript.js and create-client.js after the earlier
// lesson about module-loading and dependency risk in this deployment.
//
// Needs ANTHROPIC_API_KEY set in this Vercel project (same key already
// used by summarize-transcript.js in the Client Portal project, if it's
// not already there).

const SUPABASE_URL = 'https://ybklqnetvmoakckfiica.supabase.co'; // same public URL already embedded in every frontend file

// ---- Ported directly from shared/availability.js's computeAvailableSlots ----
// Identical logic, not a re-implementation — keeps this assistant's real
// availability answers consistent with every other real booking surface
// in the app (calendar-based booking, staff phone booking, etc).
function computeAvailableSlots(dateISO, dayOfWeek, availability, timeOffDates, existingAppointments, durationMinutes, nowDate, minLeadTimeMinutes, bufferMinutesLookup) {
  const dayAvail = availability.find(a => a.day_of_week === dayOfWeek);
  if (!dayAvail || !dayAvail.is_open) return [];
  if (timeOffDates.includes(dateISO)) return [];

  const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const openStart = toMinutes(dayAvail.start_time);
  const openEnd = toMinutes(dayAvail.end_time);

  const busyRanges = existingAppointments
    .filter(a => a.dateKey === dateISO)
    .map(a => {
      const buffer = (bufferMinutesLookup && a.service_id && bufferMinutesLookup[a.service_id]) || 0;
      return [a.startMinutes, a.endMinutes + buffer];
    });

  const slots = [];
  const stepMinutes = 30;
  for (let start = openStart; start + durationMinutes <= openEnd; start += stepMinutes) {
    const end = start + durationMinutes;
    if (busyRanges.some(([bs, be]) => start < be && end > bs)) continue;
    if (nowDate && dateISO === nowDate.dateKey) {
      const leadMinutes = minLeadTimeMinutes || 0;
      if (start <= nowDate.minutesOfDay + leadMinutes) continue;
    }
    const h24 = Math.floor(start / 60), m = start % 60;
    const period = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    slots.push(`${h12}:${m.toString().padStart(2, '0')} ${period}`);
  }
  return slots;
}

// Same domain terminology reference already used for AI session
// summaries in summarize-transcript.js — reused here so the home
// concierge's service/practitioner recommendations for a described
// need ("my shoulders are tight", "I'm stressed") are grounded in the
// same real vocabulary, not separately guessed at.
const TAXONOMY = `
YOGA
Poses/asanas: Downward Dog, Child's Pose, Cat-Cow, Warrior I/II/III, Triangle Pose, Pigeon Pose,
Bridge Pose, Cobra Pose, Seated Forward Fold, Corpse Pose (Savasana), Sun Salutation (Surya
Namaskar), Tree Pose, Chair Pose.
Concepts: vinyasa (flow), asana, alignment, drishti (gaze point), bandha (energy lock), restorative
yoga, yin yoga, prana.
Common observations/complaints (start of session): tight hip flexors, hamstring tightness, shoulder
impingement, rounded shoulders, limited hip/shoulder mobility, lower back strain, sciatica, postural
imbalance.
Session outcomes/results (end of session): increased flexibility, improved range of motion, reduced
muscle tension, better postural alignment, increased body awareness, deeper breath capacity,
improved balance, greater ease in a pose, reduced pain/discomfort.
Practitioner phrasing (instructions/assessment, in their own voice): "let's work on opening the
hips," "engage your core," "find length through the spine," "let's modify this for your shoulder,"
"breathe into the stretch," "let's build strength in your legs today," "I want you to feel grounded
through your feet."
Follow-up self-report (returning client, reporting since last visit): "hip flexors feel looser,"
"lower back pain has eased," "been doing the stretches at home," "still tight in the same spot,"
"flexibility has improved since last time," "haven't had time to practice between sessions."

AYURVEDA
Doshas: Vata (air/space — movement, dryness, anxiety when aggravated), Pitta (fire/water —
transformation, heat, irritability/inflammation when aggravated), Kapha (earth/water — structure,
stability, lethargy/congestion when aggravated).
Concepts: Prakriti (natural constitution), Vikriti (current state/imbalance), Agni (digestive fire),
Ama (toxins/undigested residue), Dinacharya (daily routine practice), Abhyanga (self oil massage),
Panchakarma (detoxification therapies).
Common observations/complaints (start of session): dosha imbalance, aggravated vata/pitta/kapha,
digestive sluggishness (low agni), signs of ama buildup.
Session outcomes/results (end of session): improved digestion/agni, more balanced dosha state,
reduced vata/pitta/kapha aggravation, calmer nervous system, improved elimination, reduced bloating.
Practitioner phrasing (instructions/assessment, in their own voice): "this suggests a vata
imbalance," "let's work on grounding your energy," "I'd recommend warming, cooked foods this week,"
"your agni seems low today," "let's focus on calming excess pitta," "try an oil massage before bed."
Follow-up self-report (returning client, reporting since last visit): "digestion has been better,"
"sleep improved since starting the routine," "still feeling ungrounded/anxious," "skin has cleared
up," "energy levels more stable," "haven't been following the dinacharya routine consistently."

MASSAGE / BODYWORK
Techniques: Swedish massage, deep tissue, myofascial release, trigger point therapy, effleurage,
petrissage, cupping, hot stone.
Common observations/complaints (start of session): muscle knots/trigger points, fascial
restriction, adhesions, myalgia, reduced range of motion (ROM), delayed onset muscle soreness
(DOMS), postural imbalance, chronic tension.
Session outcomes/results (end of session): reduced muscle tension, improved range of motion,
decreased trigger point sensitivity, reduced pain, improved circulation, greater relaxation, reduced
stiffness.
Practitioner phrasing (instructions/assessment, in their own voice): "I'm going to apply some deeper
pressure here," "let's work on releasing this trigger point," "I'm noticing some tension in this
area," "let's focus on your shoulders today," "I'll use some myofascial release technique here,"
"let me know if the pressure is too much."
Follow-up self-report (returning client, reporting since last visit): "the knot in my shoulder feels
better," "pain has decreased since last session," "stiffness returned after a few days," "range of
motion has improved," "was sore for a day or two after last time."

BREATHWORK / PRANAYAMA
Techniques: diaphragmatic breathing, box breathing, alternate nostril breathing (Nadi Shodhana),
Kapalabhati (skull-shining breath), Ujjayi (ocean breath), 4-7-8 breathing, holotropic breathwork,
breath retention (kumbhaka).
Common observations/complaints (start of session): shallow/chest breathing, hyperventilation
tendency, nervous system dysregulation, low vagal tone.
Session outcomes/results (end of session): calmer nervous system, reduced anxiety, improved breath
capacity, greater relaxation, reduced racing thoughts, increased vagal tone/parasympathetic
activation.
Practitioner phrasing (instructions/assessment, in their own voice): "let's slow down your breath,"
"try to extend your exhale," "let's activate your parasympathetic response," "breathe deeply into
your belly," "let's try alternate nostril breathing today," "notice how your body feels as you
slow down."
Follow-up self-report (returning client, reporting since last visit): "sleep has improved since we
started," "still feel anxious, racing thoughts," "practicing the breathing exercises daily," "felt
calmer after last session but it faded," "stress levels have gone down."

MEDITATION & MINDFULNESS
Techniques: body scan, loving-kindness (Metta) meditation, guided visualization, mindfulness-based
stress reduction (MBSR), mantra meditation, walking meditation, transcendental meditation.
Common observations/complaints (start of session): racing/"monkey mind," rumination, difficulty
with present-moment awareness, stress reactivity.
Session outcomes/results (end of session): reduced stress reactivity, improved present-moment
awareness, calmer mental state, reduced rumination, greater emotional regulation, improved focus.
Practitioner phrasing (instructions/assessment, in their own voice): "let's bring awareness to the
present moment," "notice any thoughts without judgment," "let's try a body scan today," "let's work
on quieting the mind," "use your breath as an anchor," "just observe whatever comes up."
Follow-up self-report (returning client, reporting since last visit): "meditating daily since last
session," "mind still wanders a lot," "feeling calmer overall," "noticed less reactivity to stress,"
"haven't kept up the practice."

REIKI / ENERGY HEALING
Concepts: chakras (root, sacral, solar plexus, heart, throat, third eye, crown), aura, hands-on vs.
hands-off healing, distance/remote healing, Reiki attunement, universal life force energy
(Ki/Chi/Prana), energetic clearing.
Common observations/complaints (start of session): chakra blockage, energy imbalance, feeling
ungrounded, energetic heaviness or stagnation.
Session outcomes/results (end of session): reduced energetic heaviness, greater sense of
balance/grounding, sense of lightness or release, improved emotional clarity.
Practitioner phrasing (instructions/assessment, in their own voice): "I'm sensing some blockage in
your heart chakra," "let's work on clearing your energy," "I'll place my hands here to promote
healing," "your energy feels more balanced now," "let's focus on grounding your root chakra," "just
relax and let the energy flow."
Follow-up self-report (returning client, reporting since last visit): "felt lighter after last
session," "energy has felt more balanced," "still feeling blocked/stuck," "sleep improved after the
session," "noticed an emotional release in the days after."
`.trim();


function dateKeyAndMinutes(isoString, timezone) {
  const d = new Date(isoString);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t).value;
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    minutesOfDay: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10)
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed — use POST.' });
    return;
  }

  const { messages, accessToken, anonKey, guestTenantId, timezone, todayDateKey, entryPoint } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    res.status(400).json({ error: 'Missing conversation messages.' });
    return;
  }
  if (!anonKey) {
    res.status(400).json({ error: 'Missing Supabase configuration.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is not configured with an Anthropic API key (ANTHROPIC_API_KEY env var missing).' });
    return;
  }

  const isGuest = !accessToken;

  // Guests read with just the anon key — the exact same trust model the
  // traditional guest booking/gift-card forms already rely on (public
  // RLS read access scoped by tenant_id, not by identity). Signed-in
  // requests use the real user's own access token, so RLS applies under
  // their actual identity instead.
  const restGet = async (path) => {
    const resp = await fetch(SUPABASE_URL + path, {
      headers: { 'apikey': anonKey, 'Authorization': 'Bearer ' + (isGuest ? anonKey : accessToken) }
    });
    if (!resp.ok) return null;
    return resp.json();
  };

  let callerProfile = null;
  let tenantId = null;

  if (isGuest) {
    if (!guestTenantId) { res.status(400).json({ error: 'Missing tenant context.' }); return; }
    tenantId = guestTenantId;
  } else {
    try {
      const userResp = await fetch(SUPABASE_URL + '/auth/v1/user', {
        headers: { 'apikey': anonKey, 'Authorization': 'Bearer ' + accessToken }
      });
      if (!userResp.ok) { res.status(401).json({ error: 'Invalid or expired session.' }); return; }
      const callerUser = await userResp.json();
      const profileRows = await restGet('/rest/v1/profiles?id=eq.' + callerUser.id + '&select=*');
      callerProfile = profileRows && profileRows[0];
      if (!callerProfile) { res.status(403).json({ error: 'No client profile found for this account.' }); return; }
      tenantId = callerProfile.tenant_id;
    } catch (err) {
      res.status(401).json({ error: 'Could not verify session.' });
      return;
    }
  }

  const tz = timezone || 'America/New_York';

  // ---- Tool implementations — each hits real Supabase data, nothing invented ----

  async function toolGetServices() {
    const services = await restGet('/rest/v1/services?tenant_id=eq.' + tenantId + '&active=eq.true&select=id,name,price,duration_minutes,buffer_minutes,min_lead_time_minutes');
    return { services: services || [] };
  }

  async function toolGetPractitioners() {
    const staffRows = await restGet('/rest/v1/profiles?tenant_id=eq.' + tenantId + '&role=in.(staff,owner)&select=id,full_name,specialty,bio');
    if (!staffRows || !staffRows.length) return { practitioners: [] };
    const links = await restGet('/rest/v1/practitioner_services?select=practitioner_id,service_id');
    const services = await restGet('/rest/v1/services?tenant_id=eq.' + tenantId + '&active=eq.true&select=id,name');
    const serviceNameById = {};
    (services || []).forEach(s => { serviceNameById[s.id] = s.name; });
    const servicesByPractitioner = {};
    (links || []).forEach(l => {
      if (!servicesByPractitioner[l.practitioner_id]) servicesByPractitioner[l.practitioner_id] = [];
      if (serviceNameById[l.service_id]) servicesByPractitioner[l.practitioner_id].push(serviceNameById[l.service_id]);
    });
    return {
      practitioners: staffRows.map(p => ({
        practitionerId: p.id,
        name: p.full_name,
        specialty: p.specialty || null,
        bio: p.bio || null,
        servicesOffered: servicesByPractitioner[p.id] || []
      }))
    };
  }

  async function toolGetPackages() {
    // Packages always require a real account to hold the session credit
    // — matches the exact same rule the traditional Packages screen
    // enforces, not a new restriction invented here.
    if (isGuest) return { requiresSignIn: true };
    const packages = await restGet('/rest/v1/packages?tenant_id=eq.' + tenantId + '&active=eq.true&select=id,name,price,sessions_included,reference_service_id');
    if (!packages || !packages.length) return { packages: [] };
    const refServiceIds = [...new Set(packages.map(p => p.reference_service_id).filter(Boolean))];
    let refServices = {};
    if (refServiceIds.length) {
      const services = await restGet('/rest/v1/services?id=in.(' + refServiceIds.join(',') + ')&select=id,name,price');
      (services || []).forEach(s => { refServices[s.id] = s; });
    }
    return {
      packages: packages.map(p => {
        const perSession = p.price / p.sessions_included;
        const ref = refServices[p.reference_service_id];
        let savingsNote = `$${perSession.toFixed(2)} per session`;
        if (ref) {
          const savings = (ref.price * p.sessions_included) - p.price;
          if (savings > 0) savingsNote = `$${perSession.toFixed(2)}/session — genuinely saves $${savings.toFixed(2)} versus booking ${ref.name} individually at $${ref.price}/session`;
        }
        return { packageId: p.id, name: p.name, price: p.price, sessionsIncluded: p.sessions_included, savingsNote };
      })
    };
  }

  async function toolGetClientHistory() {
    if (isGuest) return { hasHistory: false };

    const appts = await restGet('/rest/v1/appointments?client_id=eq.' + callerProfile.id + '&select=service_name,practitioner_id,start_time,status&order=start_time.desc&limit=5');
    if (!appts || !appts.length) return { hasHistory: false };
    const practitionerIds = [...new Set(appts.map(a => a.practitioner_id).filter(Boolean))];
    let practitionerNames = {};
    if (practitionerIds.length) {
      const people = await restGet('/rest/v1/profiles?id=in.(' + practitionerIds.join(',') + ')&select=id,full_name');
      (people || []).forEach(p => { practitionerNames[p.id] = p.full_name; });
    }
    return {
      hasHistory: true,
      clientFirstName: (callerProfile.full_name || '').split(' ')[0] || null,
      recentAppointments: appts.map(a => ({
        service: a.service_name,
        practitioner: practitionerNames[a.practitioner_id] || 'a practitioner',
        date: a.start_time.slice(0, 10),
        status: a.status
      }))
    };
  }

  async function toolCheckAvailability({ service_name, days_ahead, preferred_days_of_week, preferred_time_of_day }) {
    const services = await restGet('/rest/v1/services?tenant_id=eq.' + tenantId + '&active=eq.true&select=*');
    const service = (services || []).find(s => s.name.toLowerCase().includes((service_name || '').toLowerCase()));
    if (!service) return { error: 'No matching active service found for "' + service_name + '".' };

    const links = await restGet('/rest/v1/practitioner_services?service_id=eq.' + service.id + '&select=practitioner_id');
    const practitionerIds = [...new Set((links || []).map(l => l.practitioner_id))];
    if (!practitionerIds.length) return { error: 'No practitioner is currently assigned to this service.' };

    const dayMap = { sunday: 'sun', monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat' };
    const wantedDows = (preferred_days_of_week || []).map(d => dayMap[d.toLowerCase()]).filter(Boolean);
    const windowDays = Math.min(days_ahead || 14, 21);
    const nowMoment = dateKeyAndMinutes(new Date().toISOString(), tz);
    const startDate = new Date((todayDateKey || nowMoment.dateKey) + 'T00:00:00');

    const results = [];
    for (const practitionerId of practitionerIds) {
      if (results.length >= 8) break;
      const [avail, timeOff, appts, allServices] = await Promise.all([
        restGet('/rest/v1/practitioner_availability?practitioner_id=eq.' + practitionerId + '&select=*'),
        restGet('/rest/v1/practitioner_time_off?practitioner_id=eq.' + practitionerId + '&select=date'),
        restGet('/rest/v1/appointments?practitioner_id=eq.' + practitionerId + '&status=neq.cancelled&select=start_time,end_time,service_id'),
        restGet('/rest/v1/services?select=id,buffer_minutes')
      ]);
      const timeOffDates = (timeOff || []).map(t => t.date);
      const bufferLookup = {};
      (allServices || []).forEach(s => { bufferLookup[s.id] = s.buffer_minutes || 0; });
      const existingAppointments = (appts || []).map(a => {
        const s = dateKeyAndMinutes(a.start_time, tz);
        const e = dateKeyAndMinutes(a.end_time, tz);
        return { dateKey: s.dateKey, startMinutes: s.minutesOfDay, endMinutes: e.minutesOfDay, service_id: a.service_id };
      });

      for (let i = 0; i < windowDays && results.length < 8; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        const dow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()];
        if (wantedDows.length && !wantedDows.includes(dow)) continue;
        const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        let slots = computeAvailableSlots(dateStr, dow, avail || [], timeOffDates, existingAppointments, service.duration_minutes, nowMoment, service.min_lead_time_minutes || 0, bufferLookup);
        if (preferred_time_of_day) {
          slots = slots.filter(t => {
            const [hStr, period] = t.split(' ');
            let h = parseInt(hStr.split(':')[0], 10);
            if (period === 'PM' && h !== 12) h += 12;
            if (period === 'AM' && h === 12) h = 0;
            if (preferred_time_of_day === 'morning') return h < 12;
            if (preferred_time_of_day === 'afternoon') return h >= 12 && h < 17;
            if (preferred_time_of_day === 'evening') return h >= 17;
            return true;
          });
        }
        for (const t of slots) {
          if (results.length >= 8) break;
          results.push({ date: dateStr, time: t, serviceId: service.id, serviceName: service.name, price: service.price, practitionerId });
        }
      }
    }
    if (!results.length) return { slots: [], note: 'No open times found in the next ' + windowDays + ' days matching that request.' };
    const practitionerNames = {};
    const people = await restGet('/rest/v1/profiles?id=in.(' + [...new Set(results.map(r => r.practitionerId))].join(',') + ')&select=id,full_name');
    (people || []).forEach(p => { practitionerNames[p.id] = p.full_name; });
    return { slots: results.map(r => ({ ...r, practitionerName: practitionerNames[r.practitionerId] || 'a practitioner' })) };
  }

  const validEntryPoints = ['booking', 'gift_card', 'package', 'home'];
  if (!validEntryPoints.includes(entryPoint)) {
    res.status(400).json({ error: 'Missing or invalid entry point.' });
    return;
  }

  const historyTool = !isGuest ? [{
    name: 'get_client_history',
    description: 'Get this signed-in client\'s recent real appointment history, if any, so you can personalize the conversation for a returning client (e.g. offer their usual service/practitioner) rather than starting from scratch.',
    input_schema: { type: 'object', properties: {} }
  }] : [];

  const presentOptionsTool = {
    name: 'present_options',
    description: 'Show the client a short list of clickable choices instead of making them type. Use this whenever you have a short real list to offer, or whenever a simple choice would be faster than typing. IMPORTANT: for appointment times, ALWAYS include the full date with every single option, even if the conversation has already narrowed down to one specific day — never a bare time-only label like "9:00 AM" on its own, always "Thu Sep 18, 9:00 AM" style, so it is unambiguous at a glance which day each option is actually for. ALSO IMPORTANT: your own text message should be short and NOT list out the actual times/dates/options one by one — the buttons already show all of that; your text just needs a brief lead-in like "Here are some openings — take your pick:", not a repeat of every option in prose.',
    input_schema: {
      type: 'object',
      properties: { options: { type: 'array', items: { type: 'string' }, description: 'Short button labels. For appointment times: "Tue Sep 16, 2:00 PM" style always, date AND time together, never time alone.' } },
      required: ['options']
    }
  };

  const mentionManualOptionTool = {
    name: 'mention_manual_option',
    description: 'Call this whenever you want to let the client know they can also handle this themselves using the manual option on the page, INSTEAD of just saying so in your own words — this renders a real clickable link for them rather than plain text they cannot act on.',
    input_schema: { type: 'object', properties: {} }
  };

  const presentPractitionersTool = {
    name: 'present_practitioners',
    description: 'Show real practitioner options as cards (name, specialty, and expandable bio) instead of describing them in plain text. Use this ONLY when there is more than one real practitioner eligible for the chosen service — with just one, there is no real choice to present, so skip straight to check_availability instead. Get the real data from get_practitioners first; never invent a specialty or bio.',
    input_schema: {
      type: 'object',
      properties: {
        practitioners: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              practitionerId: { type: 'string' },
              name: { type: 'string' },
              specialty: { type: 'string' },
              bio: { type: 'string' }
            },
            required: ['practitionerId', 'name']
          }
        }
      },
      required: ['practitioners']
    }
  };

  // Tools are scoped strictly to the entry point the person actually
  // chose — this assistant does NOT pivot between booking, gift cards,
  // and packages within one conversation. If someone asks for something
  // else, the system prompt below tells it to redirect them to close
  // this chat and use the matching button instead, rather than handling
  // it here.
  let tools;
  if (entryPoint === 'booking') {
    tools = [
      { name: 'get_services', description: 'Get the real list of active services this business offers, with real prices and durations. Call this before recommending or confirming any service.', input_schema: { type: 'object', properties: {} } },
      {
        name: 'get_practitioners',
        description: 'Get real practitioner profiles (specialty, bio) and which real services each offers. Call this once a service is chosen, to see how many real practitioners are actually eligible for it before deciding whether to show a choice.',
        input_schema: { type: 'object', properties: {} }
      },
      presentPractitionersTool,
      ...historyTool,
      {
        name: 'check_availability',
        description: 'Get REAL open appointment slots for a service, optionally filtered by day-of-week and/or time-of-day preference. Always use this rather than guessing at availability — never invent a time.',
        input_schema: {
          type: 'object',
          properties: {
            service_name: { type: 'string', description: 'The service to check, matched against real service names' },
            days_ahead: { type: 'integer', description: 'How many days ahead to search, default 14, max 21' },
            preferred_days_of_week: { type: 'array', items: { type: 'string' }, description: 'Full day names the client mentioned, e.g. ["Tuesday","Thursday"], or omit if none' },
            preferred_time_of_day: { type: 'string', enum: ['morning', 'afternoon', 'evening'], description: 'Omit if not stated' }
          },
          required: ['service_name']
        }
      },
      presentOptionsTool,
      mentionManualOptionTool,
      {
        name: 'ready_to_book',
        description: 'Call this ONLY once the client has explicitly confirmed a specific real service, practitioner, date, and time from what check_availability actually returned — never a slot you have not verified is real.' + (isGuest ? ' Since this person is not signed in, you must also have collected their name, email, and phone before calling this.' : ''),
        input_schema: {
          type: 'object',
          properties: {
            serviceId: { type: 'string' }, practitionerId: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'e.g. "2:00 PM"' },
            guestName: { type: 'string', description: 'Required if not signed in, omit if signed in' },
            guestEmail: { type: 'string', description: 'Required if not signed in, omit if signed in' },
            guestPhone: { type: 'string', description: 'Required if not signed in, omit if signed in' }
          },
          required: isGuest ? ['serviceId', 'practitionerId', 'date', 'time', 'guestName', 'guestEmail', 'guestPhone'] : ['serviceId', 'practitionerId', 'date', 'time']
        }
      }
    ];
  } else if (entryPoint === 'gift_card') {
    tools = [
      ...historyTool,
      presentOptionsTool,
      mentionManualOptionTool,
      {
        name: 'ready_for_gift_card',
        description: 'Call this ONLY once the client has explicitly confirmed a specific dollar amount for a gift card purchase, and given recipient info if it is a gift for someone else.' + (isGuest ? ' Since this person is not signed in, you must also have collected their own name and email (the purchaser, not necessarily the recipient) before calling this.' : ''),
        input_schema: {
          type: 'object',
          properties: {
            amount: { type: 'number' },
            recipientName: { type: 'string', description: 'Omit if this is for themselves' },
            recipientEmail: { type: 'string', description: 'Omit if this is for themselves — note: for a guest purchaser, only recipient NAME is actually used, not a separate recipient email' },
            purchaserName: { type: 'string', description: 'Required if not signed in (this is the buyer, not the recipient), omit if signed in' },
            purchaserEmail: { type: 'string', description: 'Required if not signed in (this is the buyer, not the recipient), omit if signed in' }
          },
          required: isGuest ? ['amount', 'purchaserName', 'purchaserEmail'] : ['amount']
        }
      }
    ];
  } else if (entryPoint === 'package') {
    tools = [
      {
        name: 'get_packages',
        description: 'Get the real list of session packages this business offers, with real prices and a genuine savingsNote for each — use that savings figure directly in your pitch when it exists (e.g. mention the real dollar amount saved versus booking individually), never invent your own comparison. Packages always require a signed-in account — if this returns requiresSignIn, tell the person they need to sign in first and do not proceed further.',
        input_schema: { type: 'object', properties: {} }
      },
      ...historyTool,
      presentOptionsTool,
      mentionManualOptionTool,
      {
        name: 'ready_to_purchase_package',
        description: 'Call this ONLY once the signed-in client has explicitly confirmed a specific real package by name. Never call this for a guest — get_packages already tells you if sign-in is required.',
        input_schema: {
          type: 'object',
          properties: { packageId: { type: 'string' }, packageName: { type: 'string' } },
          required: ['packageId', 'packageName']
        }
      }
    ];
  } else { // 'home' — the general concierge, deliberately UNIFIED rather
            // than scoped like the three above. Its whole purpose is
            // helping someone who isn't sure what they need yet, so it
            // needs everything available and the freedom to pivot.
    tools = [
      { name: 'get_services', description: 'Get the real list of active services this business offers, with real prices and durations.', input_schema: { type: 'object', properties: {} } },
      {
        name: 'get_practitioners',
        description: 'Get real practitioner profiles — their specialty, bio, and which real services they offer. Use this to make a genuine, grounded recommendation when someone describes a need (e.g. shoulder tension, stress, wanting to try yoga) rather than guessing who might be a good fit.',
        input_schema: { type: 'object', properties: {} }
      },
      presentPractitionersTool,
      {
        name: 'get_packages',
        description: 'Get the real list of session packages this business offers, with a genuine savingsNote for each — use that savings figure directly in your pitch when it exists, never invent your own comparison. Packages always require a signed-in account — if this returns requiresSignIn, tell the person they need to sign in first before going further with a package.',
        input_schema: { type: 'object', properties: {} }
      },
      ...historyTool,
      {
        name: 'check_availability',
        description: 'Get REAL open appointment slots for a service, optionally filtered by day-of-week and/or time-of-day preference. Always use this rather than guessing at availability — never invent a time.',
        input_schema: {
          type: 'object',
          properties: {
            service_name: { type: 'string', description: 'The service to check, matched against real service names' },
            days_ahead: { type: 'integer', description: 'How many days ahead to search, default 14, max 21' },
            preferred_days_of_week: { type: 'array', items: { type: 'string' }, description: 'Full day names the client mentioned, e.g. ["Tuesday","Thursday"], or omit if none' },
            preferred_time_of_day: { type: 'string', enum: ['morning', 'afternoon', 'evening'], description: 'Omit if not stated' }
          },
          required: ['service_name']
        }
      },
      presentOptionsTool,
      {
        name: 'show_directory_link',
        description: 'Show a real link to the full practitioner directory page, for when someone wants to browse everyone rather than get one specific recommendation. This is a real navigation link, not a chat option — it takes them to a different page.',
        input_schema: { type: 'object', properties: {} }
      },
      {
        name: 'ready_to_book',
        description: 'Call this ONLY once the client has explicitly confirmed a specific real service, practitioner, date, and time from what check_availability actually returned — never a slot you have not verified is real.' + (isGuest ? ' Since this person is not signed in, you must also have collected their name, email, and phone before calling this.' : ''),
        input_schema: {
          type: 'object',
          properties: {
            serviceId: { type: 'string' }, practitionerId: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'e.g. "2:00 PM"' },
            guestName: { type: 'string', description: 'Required if not signed in, omit if signed in' },
            guestEmail: { type: 'string', description: 'Required if not signed in, omit if signed in' },
            guestPhone: { type: 'string', description: 'Required if not signed in, omit if signed in' }
          },
          required: isGuest ? ['serviceId', 'practitionerId', 'date', 'time', 'guestName', 'guestEmail', 'guestPhone'] : ['serviceId', 'practitionerId', 'date', 'time']
        }
      },
      {
        name: 'ready_for_gift_card',
        description: 'Call this ONLY once the client has explicitly confirmed a specific dollar amount for a gift card purchase, and given recipient info if it is a gift for someone else.' + (isGuest ? ' Since this person is not signed in, you must also have collected their own name and email (the purchaser, not necessarily the recipient) before calling this.' : ''),
        input_schema: {
          type: 'object',
          properties: {
            amount: { type: 'number' },
            recipientName: { type: 'string', description: 'Omit if this is for themselves' },
            recipientEmail: { type: 'string', description: 'Omit if this is for themselves' },
            purchaserName: { type: 'string', description: 'Required if not signed in, omit if signed in' },
            purchaserEmail: { type: 'string', description: 'Required if not signed in, omit if signed in' }
          },
          required: isGuest ? ['amount', 'purchaserName', 'purchaserEmail'] : ['amount']
        }
      },
      {
        name: 'ready_to_purchase_package',
        description: 'Call this ONLY once the signed-in client has explicitly confirmed a specific real package by name. Never call this for a guest.',
        input_schema: {
          type: 'object',
          properties: { packageId: { type: 'string' }, packageName: { type: 'string' } },
          required: ['packageId', 'packageName']
        }
      }
    ];
  }

  const entryPointLabel = { booking: 'booking an appointment', gift_card: 'buying a gift card', package: 'buying a session package' }[entryPoint];

  const scopingInstruction = entryPoint === 'home'
    ? "You're the general concierge for the whole business — you can help with anything: recommending a service or practitioner based on what someone describes needing, explaining what the studio offers, booking an appointment, buying a gift card, or a session package. If someone describes a need (sore shoulders, wanting to de-stress, curious about yoga), use get_practitioners and get_services to make a real, grounded recommendation — never invent a specialty or bio that get_practitioners didn't actually return. If they'd rather browse everyone themselves, call show_directory_link. If they decide to book and more than one real practitioner offers that service, call present_practitioners with real bios so they can pick based on genuine fit; with only one, just mention them naturally and move on to checking availability. "
    : "This conversation is SPECIFICALLY for " + entryPointLabel + " — that is the only thing you help with here. If the person asks about something else this chat doesn't cover, tell them warmly that you can help with that from the matching option on the page — close this chat and use that button instead — rather than trying to handle it in this conversation. Do not pivot to a different capability just because they ask; only tools for " + entryPointLabel + " are available to you here regardless. " +
      (entryPoint === 'booking' ? "Start simply — ask what they need, the way a front desk person would, rather than assuming. If they describe an issue or need (tight shoulders, wanting to try yoga, stress) instead of naming a specific service, call get_services to see everything real that's offered and consider ALL of it — massage, yoga, Ayurvedic consultation, breathwork, whatever is actually active — and offer whichever genuinely fit, not just the first one that comes to mind. Once a service is settled, call get_practitioners and check how many real practitioners actually offer it: if there's more than one, call present_practitioners with their real bios so the person can pick based on genuine fit before you check availability; if there's only one, there's no real choice to present — just mention them naturally in passing and go straight to check_availability. " : "");

  const systemPrompt = "You are a warm, efficient front-desk assistant for a wellness studio (Raaka Rituals), helping over chat the way a great in-person receptionist would - natural, unhurried, but quick to get to real information. " +
    scopingInstruction +
    "Always use tools to get real data - NEVER invent a price, service name, availability, specialty, or bio. If the client gives casual time language (like next week sometime, or after work), translate that into the days_ahead/preferred_days_of_week/preferred_time_of_day parameters for check_availability rather than asking them to restate it formally. " +
    "If get_client_history shows a returning client, use it naturally (e.g. Welcome back, same Deep Tissue session as last time with Amara, or something different today) rather than starting from zero. " +
    "When you have real options to offer (like time slots or packages), call present_options so they appear as tappable buttons - do not just list them in plain text. " +
    "Keep your own messages short - a sentence or two, not paragraphs. Confirm the specific real details clearly before calling any finalize tool, and only call one once the client has clearly said yes to that specific thing. " +
    "Today's date is " + (todayDateKey || 'unknown') + "." +
    (isGuest ? " This person is NOT signed in — before finalizing, naturally collect their name, email, and (for booking only) phone number, the way a receptionist would ask for contact info from a new caller, not as a rigid form." : " This person is signed in, so their contact info is already on file — don't ask for it again.") +
    (entryPoint !== 'home' ? " Once you understand what they're generally looking for, call mention_manual_option once to let them know they can also handle this themselves on the page — do this by calling the tool, not by describing it in your own words, since only the tool actually gives them something clickable." : "") +
    ((entryPoint === 'home' || entryPoint === 'booking') ? "\n\nWhen someone describes a physical or emotional need in their own words (\"my shoulders are so tight\", \"I can't sleep\", \"I'm really stressed\"), use this real terminology reference to recognize what they're actually describing and match it to the right real service — don't just guess generically:\n\n" + TAXONOMY : "");

  try {
    let conversationMessages = messages.map(m => ({ role: m.role, content: m.content }));
    let assistantText = '';
    let showDirectoryLink = false;
    let practitionerOptions = [];
    let mentionManualOption = false;
    let quickReplies = [];
    let finalResult = null;

    for (let iteration = 0; iteration < 6; iteration++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 1024,
          system: systemPrompt,
          messages: conversationMessages,
          tools
        })
      });
      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error('Anthropic API error:', response.status, errBody);
        res.status(502).json({ error: 'The assistant is temporarily unavailable — try again in a moment.' });
        return;
      }
      const data = await response.json();
      const toolUseBlocks = (data.content || []).filter(b => b.type === 'tool_use');
      const textBlocks = (data.content || []).filter(b => b.type === 'text');
      if (textBlocks.length) assistantText = textBlocks.map(b => b.text).join('\n');

      if (!toolUseBlocks.length) break;

      const finalizeCall = toolUseBlocks.find(b => b.name === 'ready_to_book' || b.name === 'ready_for_gift_card' || b.name === 'ready_to_purchase_package');
      if (finalizeCall) {
        finalResult = { type: finalizeCall.name, params: finalizeCall.input };
        break;
      }

      conversationMessages.push({ role: 'assistant', content: data.content });
      const toolResults = [];
      for (const call of toolUseBlocks) {
        let result;
        if (call.name === 'get_services') result = await toolGetServices();
        else if (call.name === 'get_client_history') result = await toolGetClientHistory();
        else if (call.name === 'get_packages') result = await toolGetPackages();
        else if (call.name === 'get_practitioners') result = await toolGetPractitioners();
        else if (call.name === 'check_availability') result = await toolCheckAvailability(call.input || {});
        else if (call.name === 'present_options') { quickReplies = call.input.options || []; result = { shown: true }; }
        else if (call.name === 'present_practitioners') { practitionerOptions = call.input.practitioners || []; result = { shown: true }; }
        else if (call.name === 'mention_manual_option') { mentionManualOption = true; result = { shown: true }; }
        else if (call.name === 'show_directory_link') { showDirectoryLink = true; result = { shown: true }; }
        else result = { error: 'Unknown tool' };
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) });
      }
      conversationMessages.push({ role: 'user', content: toolResults });
    }

    res.status(200).json({ reply: assistantText, quickReplies, finalResult, showDirectoryLink, practitionerOptions, mentionManualOption });
  } catch (err) {
    console.error('conversational-assistant function error:', err);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
};
