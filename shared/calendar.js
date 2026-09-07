// shared/calendar.js
//
// The calendar grid, day-detail modal, appointment row rendering, and
// all the check-in/no-show/payment/cancel/receipt actions — previously
// duplicated, separately, between Staff Dashboard and Owner Dashboard.
//
// A factory function rather than plain exports, since this code depends
// on several things that differ per host file (which Supabase client to
// use, which profile object, whether to show the practitioner's name on
// each row) — each host file calls createCalendarModule(config) once,
// with its own specifics, and gets back a consistent set of functions
// that behave correctly for that file.
//
// Depends on the shared timezone.js and modal.js modules also being
// loaded (for tenant-timezone-aware date handling and the
// customConfirm/customPrompt dialogs) — pass their functions in via
// config rather than importing them directly here, so this module
// doesn't need to know the exact relative path back to those from
// wherever it's loaded.

export function createCalendarModule(config) {
  const {
    getClient,               // () => the current Supabase client (pilotClient / ownerDbClient)
    getTenantId,             // () => the current tenant id
    showPractitionerColumn,  // () => whether to show "with [name]" on each row
    getDateAndMinutesInTimezone,
    getTodayDateKeyInTenantTimezone,
    setTenantTimezone,
    customConfirm,
    customPrompt,
    getAdditionalAppointments, // optional: () => extra appointments to search for receipts (e.g. Staff Dashboard's realTodaysAppointments), not every host file has this
    businessName = 'Raaka Rituals',
  } = config;

  let calendarViewDate = new Date();
  let calendarMonthAppointments = [];
  let calendarSelectedDateKey = null;
  let currentApptViewRefresh = async () => {};

  async function loadCalendarMonthAppointments(year, month) {
    const client = getClient();
    const tenantId = getTenantId();
    if (!client || !tenantId) return;

    const { data: tenantRow } = await client.from('tenants').select('timezone').eq('id', tenantId).single();
    if (tenantRow && tenantRow.timezone) setTenantTimezone(tenantRow.timezone);

    // Padded a day on each side — the query range only needs to be wide
    // enough to not miss anything; the actual per-day grouping below
    // uses the tenant's real timezone, so anything extra just correctly
    // lands in an adjacent month's date, never shown wrong here.
    const startOfMonth = new Date(year, month, 1);
    startOfMonth.setDate(startOfMonth.getDate() - 1);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);
    endOfMonth.setDate(endOfMonth.getDate() + 1);

    // Includes cancelled, unlike today's schedule — the calendar is a
    // real overview/history tool, so cancelled appointments are still
    // worth seeing for the day they were cancelled from.
    const { data: appts, error } = await client.from('appointments')
      .select('*').eq('tenant_id', tenantId)
      .gte('start_time', startOfMonth.toISOString()).lte('start_time', endOfMonth.toISOString())
      .order('start_time', { ascending: true });
    if (error) { console.error('Could not load calendar appointments:', error); return; }

    const peopleIds = [...new Set([
      ...(appts || []).map(a => a.client_id),
      ...(appts || []).map(a => a.practitioner_id)
    ])];
    let peopleNames = {};
    if (peopleIds.length) {
      const { data: people } = await client.from('profiles').select('id, full_name').in('id', peopleIds);
      (people || []).forEach(p => { peopleNames[p.id] = p.full_name; });
    }

    calendarMonthAppointments = (appts || []).map(a => ({
      id: a.id,
      time: new Date(a.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      startTime: a.start_time,
      endTime: a.end_time,
      dateKey: getDateAndMinutesInTimezone(new Date(a.start_time)).dateKey,
      clientName: peopleNames[a.client_id] || 'Unknown client',
      clientId: a.client_id,
      practitionerName: peopleNames[a.practitioner_id] || 'Unknown practitioner',
      service: a.service_name,
      servicePrice: a.service_price,
      rawStatus: a.status,
      intendedPaymentMethod: a.intended_payment_method,
      status: a.status === 'completed' ? 'completed' : 'upcoming',
      isReal: true
    }));
  }

  async function renderCalendarScreen() {
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    await loadCalendarMonthAppointments(year, month);

    document.getElementById('calendar-month-label').textContent =
      calendarViewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const apptsByDate = {};
    calendarMonthAppointments.forEach(a => {
      (apptsByDate[a.dateKey] = apptsByDate[a.dateKey] || []).push(a);
    });

    const firstOfMonth = new Date(year, month, 1);
    const startWeekday = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = getTodayDateKeyInTenantTimezone();

    let cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push('<div></div>');
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayAppts = apptsByDate[dateKey] || [];
      const hasAppts = dayAppts.length > 0;
      const isToday = dateKey === todayKey;
      cells.push(`
        <div onclick="${hasAppts ? `openCalendarDayModal('${dateKey}')` : ''}"
             style="min-height:64px;border-radius:8px;padding:8px;cursor:${hasAppts ? 'pointer' : 'default'};
                    border:1px solid ${isToday ? 'var(--primary,#6B3654)' : 'var(--border,#EAE3E6)'};
                    background:${hasAppts ? 'var(--primary-lighter,#F3EAF0)' : 'var(--surface,#fff)'};">
          <div style="font-size:12.5px;font-weight:${isToday ? '700' : '500'};color:${isToday ? 'var(--primary,#6B3654)' : 'var(--text-primary)'};">${d}</div>
          ${hasAppts ? `<div style="font-size:11px;color:var(--primary-dark,#5A2A47);margin-top:4px;">${dayAppts.length} appt${dayAppts.length > 1 ? 's' : ''}</div>` : ''}
        </div>`);
    }
    document.getElementById('calendar-grid').innerHTML = cells.join('');
  }

  function calendarChangeMonth(delta) {
    calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + delta, 1);
    renderCalendarScreen();
  }

  function openCalendarDayModal(dateKey) {
    calendarSelectedDateKey = dateKey;
    currentApptViewRefresh = async () => {
      await loadCalendarMonthAppointments(calendarViewDate.getFullYear(), calendarViewDate.getMonth());
      renderCalendarDayModalList();
      renderCalendarScreen();
    };
    const dayAppts = calendarMonthAppointments.filter(a => a.dateKey === dateKey);
    document.getElementById('calendar-day-modal-title').textContent =
      new Date(dateKey + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    document.getElementById('calendar-day-modal-list').innerHTML = dayAppts.length
      ? dayAppts.map(a => renderApptRow(a, showPractitionerColumn())).join('')
      : '<div class="empty-state">No appointments this day.</div>';
    document.getElementById('calendar-day-modal-overlay').style.display = 'flex';
  }

  function renderCalendarDayModalList() {
    if (!calendarSelectedDateKey) return;
    const dayAppts = calendarMonthAppointments.filter(a => a.dateKey === calendarSelectedDateKey);
    document.getElementById('calendar-day-modal-list').innerHTML = dayAppts.length
      ? dayAppts.map(a => renderApptRow(a, showPractitionerColumn())).join('')
      : '<div class="empty-state">No appointments this day.</div>';
  }

  function closeCalendarDayModal() {
    document.getElementById('calendar-day-modal-overlay').style.display = 'none';
    calendarSelectedDateKey = null;
  }

  function renderApptRow(a, showPractitioner) {
    const now = new Date();
    const startTime = new Date(a.startTime);
    const endTime = new Date(a.endTime);
    const checkInOpensAt = new Date(startTime.getTime() - 15 * 60000);
    // Bounded on both sides — previously this only checked that the
    // start time had arrived, with no upper bound, so a confirmed
    // appointment from days ago (never checked in or marked no-show)
    // stayed eligible for "Check in" forever and kept showing as
    // "Upcoming." Closes 15 minutes past the scheduled END time, same
    // grace window used for the payment-overdue threshold below.
    const checkInClosesAt = new Date(endTime.getTime() + 15 * 60000);
    const canCheckIn = now >= checkInOpensAt && now <= checkInClosesAt;
    const checkInWindowPassed = now > checkInClosesAt;
    const canMarkNoShow = a.rawStatus === 'confirmed' && new Date(a.startTime) < new Date(Date.now() - 15 * 60000);
    // Cancelling only makes sense before the appointment was ever
    // supposed to happen — once its start time has passed, "cancel"
    // isn't the right action anymore (no-show, or leaving it as-is,
    // is), even though it's still sitting in "confirmed" status.
    const canCancel = new Date(a.startTime) > new Date();
    let statusPill, actionHtml;
    if (a.rawStatus === 'completed') {
      statusPill = `<span class="pill pill-completed">Completed</span>`;
      actionHtml = `<button class="btn btn-secondary btn-sm" onclick="openReceipt('${a.id}')">Print receipt</button>`;
    } else if (a.rawStatus === 'no_show') {
      statusPill = `<span class="pill" style="background:var(--danger-light,#fbe9e9);color:var(--danger,#A13D3D);">No-show (50% charged)</span>`;
      actionHtml = '';
    } else if (a.rawStatus === 'cancelled') {
      statusPill = `<span class="pill" style="background:var(--border,#EAE3E6);color:var(--text-muted,#8A7B82);">Cancelled</span>`;
      actionHtml = '';
    } else if (a.rawStatus === 'attended') {
      const paymentOverdue = a.endTime && new Date(a.endTime) < new Date(Date.now() - 15 * 60000);
      statusPill = paymentOverdue
        ? `<span class="pill" style="background:var(--danger-light,#fbe9e9);color:var(--danger,#A13D3D);">⚠ Payment overdue</span>`
        : `<span class="pill pill-upcoming">Attended — payment pending</span>`;
      actionHtml = `
        <select id="payvia-${a.id}" class="input-sm" style="margin-right:6px;">
          <option value="cash">Cash</option>
          <option value="card_in_person">Card (in person)</option>
          <option value="package_credit">Package credit</option>
        </select>
        <button class="btn btn-primary btn-sm" onclick="markPaymentReceived('${a.id}')">Mark payment received</button>`;
    } else if (checkInWindowPassed) {
      // Confirmed, past its normal window, with nobody having acted on
      // it yet. Deliberately NOT forcing a single outcome here — the
      // client might genuinely still be there (staff running behind on
      // a busy day is a real, common case), or they might never have
      // shown up at all. Both actions stay available; staff make the
      // real-world call, this just makes sure it's flagged instead of
      // silently sitting as "Upcoming" forever.
      statusPill = `<span class="pill" style="background:var(--danger-light,#fbe9e9);color:var(--danger,#A13D3D);">⚠ Needs follow-up</span>`;
      actionHtml = `
        <button class="btn btn-primary btn-sm" onclick="checkInAppointment('${a.id}')">Check in (late)</button>
        <button class="btn btn-secondary btn-sm" style="color:var(--danger);margin-left:6px;" onclick="markNoShow('${a.id}')">Mark no-show</button>`;
    } else {
      statusPill = `<span class="pill pill-upcoming">Upcoming</span>`;
      actionHtml = `
        ${canCheckIn
          ? `<button class="btn btn-primary btn-sm" onclick="checkInAppointment('${a.id}')">Check in</button>`
          : `<span style="font-size:12px;color:var(--text-muted);margin-right:8px;">Check-in opens ${checkInOpensAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>`}
        ${canMarkNoShow ? `<button class="btn btn-secondary btn-sm" style="color:var(--danger);margin-left:6px;" onclick="markNoShow('${a.id}')">Mark no-show</button>` : ''}
        ${canCancel ? `<button class="btn btn-secondary btn-sm" style="color:var(--danger);margin-left:6px;" onclick="cancelAppointmentFromDashboard('${a.id}')">Cancel</button>` : ''}`;
    }
    return `
    <div class="appt-row">
      <div class="appt-time">${a.time}</div>
      <div class="appt-info">
        <div class="appt-client">${a.clientName}${showPractitioner ? ` <span style="color:var(--text-muted);font-weight:400;">with ${a.practitionerName}</span>` : ''}</div>
        <div class="appt-service">${a.service}</div>
      </div>
      ${statusPill}
      ${actionHtml}
    </div>`;
  }

  function apptListError() {
    return document.getElementById('appt-list-error') || document.getElementById('calendar-appt-error') || (() => {
      const listEl = document.getElementById('appt-list') || document.getElementById('calendar-day-modal-list');
      const el = document.createElement('div');
      el.id = 'appt-list-error';
      el.className = 'giftcard-error';
      listEl.parentElement.insertBefore(el, listEl);
      return el;
    })();
  }

  async function checkInAppointment(appointmentId) {
    const errorEl = apptListError();
    const { error } = await getClient().rpc('admin_check_in_appointment', { target_appointment_id: appointmentId });
    if (error) {
      errorEl.textContent = 'Could not check in: ' + error.message;
      errorEl.classList.add('show');
      return;
    }
    errorEl.classList.remove('show');
    await currentApptViewRefresh();
  }

  async function markPaymentReceived(appointmentId) {
    const errorEl = apptListError();
    const method = document.getElementById(`payvia-${appointmentId}`).value;
    const { error } = await getClient().rpc('admin_mark_payment_received', { target_appointment_id: appointmentId, received_via: method });
    if (error) {
      errorEl.textContent = 'Could not mark payment received: ' + error.message;
      errorEl.classList.add('show');
      return;
    }
    errorEl.classList.remove('show');
    await currentApptViewRefresh();
  }

  async function markNoShow(appointmentId) {
    const errorEl = apptListError();
    const { error } = await getClient().rpc('admin_mark_no_show', { target_appointment_id: appointmentId });
    if (error) {
      errorEl.textContent = 'Could not mark no-show: ' + error.message;
      errorEl.classList.add('show');
      return;
    }
    errorEl.classList.remove('show');
    await currentApptViewRefresh();
  }

  async function cancelAppointmentFromDashboard(appointmentId) {
    const errorEl = apptListError();
    const confirmed = await customConfirm('Cancel this appointment?', "This can't be undone. The client will need to book a new time if they still want a session.");
    if (!confirmed) return;

    let { error } = await getClient().rpc('admin_cancel_appointment', { target_appointment_id: appointmentId, override: false, override_reason: null });

    if (error && error.message && error.message.includes('within 48 hours')) {
      const wantsOverride = await customConfirm(
        '⚠ This breaks normal cancellation policy',
        "Appointments within 48 hours normally can't be cancelled. This is an exception, not the usual process — only continue if there's a real reason (the client called, an emergency, etc). It will be recorded with your name attached."
      );
      if (!wantsOverride) return;

      const reason = await customPrompt(
        'Reason for the override',
        'Required — this gets recorded on the appointment for the record.',
        'e.g. Client called, family emergency',
        true
      );
      if (reason === null) return;
      if (!reason) {
        errorEl.textContent = 'A reason is required to cancel within 48 hours.';
        errorEl.classList.add('show');
        return;
      }
      ({ error } = await getClient().rpc('admin_cancel_appointment', { target_appointment_id: appointmentId, override: true, override_reason: reason }));
    }

    if (error) {
      errorEl.textContent = 'Could not cancel: ' + error.message;
      errorEl.classList.add('show');
      return;
    }
    errorEl.classList.remove('show');
    // Fire-and-forget — checking the waitlist should never block or
    // fail the cancellation itself, which has already succeeded by
    // this point. The actual notification send happens separately, on
    // the send-waitlist-notifications cron job, not synchronously here.
    getClient().rpc('offer_next_waitlist_spot', { cancelled_appointment_id: appointmentId })
      .then(({ error: wlError }) => { if (wlError) console.error('Waitlist check failed:', wlError); });
    await currentApptViewRefresh();
  }

  async function openReceipt(appointmentId) {
    const additional = getAdditionalAppointments ? getAdditionalAppointments() : [];
    const a = additional.find(x => x.id === appointmentId) || calendarMonthAppointments.find(x => x.id === appointmentId);
    if (!a) return;

    let paymentLine = '';
    if (a.intendedPaymentMethod === 'credit') {
      paymentLine = '1 package session credit used';
    } else if (a.intendedPaymentMethod === 'gift_card') {
      const { data: redemptions } = await getClient().from('gift_card_redemptions')
        .select('amount, gift_cards(code)').eq('appointment_id', appointmentId);
      paymentLine = (redemptions || []).map(r => `$${r.amount} — gift card ${r.gift_cards ? r.gift_cards.code : ''}`).join('<br>') || 'Paid by gift card';
    } else {
      const { data: payments } = await getClient().from('payments')
        .select('description, amount').eq('client_id', a.clientId)
        .order('created_at', { ascending: false }).limit(1);
      const p = payments && payments[0];
      paymentLine = p ? `$${p.amount} — ${p.description}` : `$${a.servicePrice || ''}`;
    }

    document.getElementById('receipt-content').innerHTML = `
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-weight:700;font-size:18px;">${businessName}</div>
        <div style="color:#888;font-size:13px;">Receipt</div>
      </div>
      <div style="border-top:1px solid #eee;border-bottom:1px solid #eee;padding:14px 0;margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>Client</span><span>${a.clientName}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>Service</span><span>${a.service}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>Time</span><span>${a.time}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>Date</span><span>${new Date(a.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
      </div>
      <div style="font-weight:600;margin-bottom:4px;">Payment</div>
      <div style="color:#444;">${paymentLine}</div>
    `;
    document.getElementById('receipt-modal-overlay').style.display = 'flex';
  }

  return {
    loadCalendarMonthAppointments,
    renderCalendarScreen,
    calendarChangeMonth,
    openCalendarDayModal,
    renderCalendarDayModalList,
    closeCalendarDayModal,
    renderApptRow,
    apptListError,
    checkInAppointment,
    markPaymentReceived,
    markNoShow,
    cancelAppointmentFromDashboard,
    openReceipt,
    setCurrentApptViewRefresh: (fn) => { currentApptViewRefresh = fn; },
    getCurrentApptViewRefresh: () => currentApptViewRefresh,
    getCalendarMonthAppointments: () => calendarMonthAppointments,
  };
}
