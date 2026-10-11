import { useState, useEffect, useCallback, useRef, useId } from 'react';
import API from '../api/axios';
import { patientName } from '../utils/patientName';
import { caseIdLabel } from '../utils/caseId';
import { can } from '../utils/permissions';
import {
  LEVEL_STYLE, PICKUP_STATE, INTERVAL_PRESETS, MEDICINE_SUGGESTIONS, MEDICINE_UNITS,
  endDateFor, pickupCount, durationOf, intervalLabel, fmtDate, medicineLine,
} from '../utils/medication';
import SidePanel, { primaryBtn, secondaryBtn } from '../components/SidePanel';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import SkeletonBlock from '../components/SkeletonBlock';
import TablePagination from '../components/TablePagination';
import { useConfirmDialog } from '../components/ConfirmDialog';

const TABS = [
  { key: '', title: 'All on treatment', desc: 'Every patient on treatment', countKey: 'all' },
  { key: 'critical', title: 'Red', desc: '3 or more missed pickups', countKey: 'critical', dot: '#EF4444', tone: '#991B1B', toneBg: 'rgba(239,68,68,0.12)' },
  { key: 'warning', title: 'Yellow', desc: '1 or 2 missed pickups', countKey: 'warning', dot: '#F59E0B', tone: '#92400E', toneBg: 'rgba(245,158,11,0.16)' },
  { key: 'ok', title: 'On track', desc: 'No missed pickups', countKey: 'ok', dot: '#10B981', tone: '#047857', toneBg: 'rgba(16,185,129,0.12)' },
  { key: 'none', title: 'No schedule', desc: 'Needs a schedule assigned', countKey: 'none', dot: '#94A3B8' },
];

const inputStyle = { background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52', borderRadius: 4 };
const errorText = (err, fallback) => err.response?.data?.error || fallback;

function WarningBadge({ level, missed }) {
  const s = LEVEL_STYLE[level || 'none'];
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap" style={{ background: s.bg, color: s.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} aria-hidden="true" />
      {s.label}{level === 'critical' && missed > 3 ? ` · ${missed} missed` : ''}
    </span>
  );
}

/* ─── Medicine name: type freely or pick a common TB medicine ─── */

function MedicineNameInput({ value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);
  const listId = useId();

  const query = value.trim().toLowerCase();
  const exact = MEDICINE_SUGGESTIONS.some(s => s.name.toLowerCase() === query);
  // Everything while empty or once a listed name is chosen; otherwise what matches the typing.
  const options = !query || exact ? MEDICINE_SUGGESTIONS : MEDICINE_SUGGESTIONS.filter(s => s.name.toLowerCase().includes(query));

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (name) => { onChange(name); setOpen(false); setActive(-1); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && active >= 0 && options[active]) { e.preventDefault(); pick(options[active].name); }
    else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={label}
        required
        autoComplete="off"
        placeholder="Choose or type a medicine"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full pl-2 pr-7 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
        style={inputStyle}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show medicines"
        onClick={() => setOpen(o => !o)}
        className="absolute right-1 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center"
        style={{ color: '#64748B' }}
      >
        <i className={`ri-arrow-down-s-line text-sm transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto rounded py-1"
          style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }}
        >
          {options.map((s, i) => {
            const selected = s.name.toLowerCase() === query;
            return (
              <li
                key={s.name}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                onMouseDown={e => { e.preventDefault(); pick(s.name); }}
                onMouseEnter={() => setActive(i)}
                className="flex cursor-pointer items-start gap-2 px-3 py-1.5"
                style={{ background: i === active ? '#EFF6FF' : 'transparent' }}
              >
                <i className={`${selected ? 'ri-check-line' : 'ri-capsule-line'} mt-0.5 text-xs`} style={{ color: selected ? '#047857' : '#94A3B8' }} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold" style={{ color: '#0F2D52' }}>{s.name}</span>
                  <span className="block text-[10px]" style={{ color: '#94A3B8' }}>{s.hint}</span>
                </span>
              </li>
            );
          })}
          {query && !exact && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={e => { e.preventDefault(); pick(value.trim()); }}
              className="cursor-pointer px-3 py-1.5 text-xs"
              style={{ color: '#2E6FAF', borderTop: options.length ? '1px solid #F1F5F9' : 'none' }}
            >
              <i className="ri-add-line mr-1" aria-hidden="true" />Use “{value.trim()}”
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/* ─── Assign / edit schedule form ─── */

const emptyMedicine = () => ({ name: '', quantity: '', unit: 'tablets', instructions: '' });

function formFromSchedule(schedule, today) {
  if (!schedule) {
    return { start_date: today, interval_days: 7, custom: false, duration_value: 6, duration_unit: 'months', medicines: [emptyMedicine()], notes: '' };
  }
  const duration = durationOf(schedule.start_date, schedule.end_date);
  return {
    start_date: schedule.start_date,
    interval_days: schedule.interval_days,
    custom: !INTERVAL_PRESETS.some(p => p.days === schedule.interval_days),
    duration_value: duration.value,
    duration_unit: duration.unit,
    medicines: (schedule.medicines || []).map(m => ({ ...emptyMedicine(), ...m, quantity: String(m.quantity) })),
    notes: schedule.notes || '',
  };
}

function ScheduleForm({ patientId, schedule, today, onSaved, onCancel }) {
  const [form, setForm] = useState(() => formFromSchedule(schedule, today));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const setMedicine = (i, key, value) => setForm(f => ({ ...f, medicines: f.medicines.map((m, j) => (j === i ? { ...m, [key]: value } : m)) }));

  const end = endDateFor(form.start_date, Number(form.duration_value), form.duration_unit);
  const count = pickupCount(form.start_date, end, form.interval_days);
  const backdated = form.start_date && form.start_date < today;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const body = {
      start_date: form.start_date,
      interval_days: Number(form.interval_days),
      duration_value: Number(form.duration_value),
      duration_unit: form.duration_unit,
      medicines: form.medicines.map(m => ({ ...m, quantity: Number(m.quantity) })),
      notes: form.notes,
    };
    try {
      if (schedule) await API.put(`/api/data/medication/schedules/${schedule.id}`, body);
      else await API.post(`/api/data/medication/${patientId}/schedule`, body);
      onSaved(schedule ? 'Schedule updated.' : 'Schedule assigned.');
    } catch (err) {
      setError(errorText(err, 'Could not save the schedule.'));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#64748B' }}>{schedule ? 'Edit schedule' : 'Assign a pickup schedule'}</p>
      {error && <p role="alert" className="rounded px-3 py-2 text-xs" style={{ background: '#FEF2F2', color: '#991B1B' }}>{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-bold mb-1" style={{ color: '#0F2D52' }}>First pickup *</span>
          <input type="date" required value={form.start_date} onChange={e => set('start_date', e.target.value)} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} />
        </label>
        <label className="block">
          <span className="block text-xs font-bold mb-1" style={{ color: '#0F2D52' }}>Pickup every *</span>
          <select
            value={form.custom ? 'custom' : String(form.interval_days)}
            onChange={e => (e.target.value === 'custom' ? set('custom', true) : setForm(f => ({ ...f, custom: false, interval_days: Number(e.target.value) })))}
            className="w-full px-3 py-2 text-xs outline-none cursor-pointer" style={inputStyle}
          >
            {INTERVAL_PRESETS.map(p => <option key={p.days} value={p.days}>{p.label}</option>)}
            <option value="custom">Custom number of days…</option>
          </select>
        </label>
      </div>
      {form.custom && (
        <label className="flex items-center gap-2 text-xs" style={{ color: '#0F2D52' }}>
          Every
          <input type="number" min={1} max={60} required value={form.interval_days} onChange={e => set('interval_days', e.target.value)} className="w-20 px-2 py-1.5 text-xs outline-none" style={inputStyle} />
          days
        </label>
      )}

      <div>
        <span className="block text-xs font-bold mb-1" style={{ color: '#0F2D52' }}>How long *</span>
        <div className="flex gap-2">
          <input type="number" min={1} required value={form.duration_value} onChange={e => set('duration_value', e.target.value)} className="w-24 px-3 py-2 text-xs outline-none" style={inputStyle} aria-label="Duration" />
          <select value={form.duration_unit} onChange={e => set('duration_unit', e.target.value)} className="px-3 py-2 text-xs outline-none cursor-pointer" style={inputStyle} aria-label="Duration unit">
            <option value="months">months</option>
            <option value="weeks">weeks</option>
            <option value="days">days</option>
          </select>
        </div>
        {end && count > 0 && (
          <p className="text-[11px] mt-1.5" style={{ color: '#475569' }}>
            <b>{count}</b> pickup{count === 1 ? '' : 's'}, last one on or before <b>{fmtDate(end)}</b>.
          </p>
        )}
        {backdated && (
          <p className="text-[11px] mt-1" style={{ color: '#92400E' }}>Past pickups count as missed until you mark them collected.</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold" style={{ color: '#0F2D52' }}>Medicines given at each pickup *</span>
          {form.medicines.length < 10 && (
            <button type="button" onClick={() => set('medicines', [...form.medicines, emptyMedicine()])} className="text-[11px] font-semibold" style={{ color: '#2E6FAF' }}>
              + Add medicine
            </button>
          )}
        </div>
        <div className="space-y-2">
          {form.medicines.map((m, i) => (
            <div key={i} className="rounded p-2.5 space-y-2" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div className="flex gap-2">
                <MedicineNameInput value={m.name} onChange={value => setMedicine(i, 'name', value)} label={`Medicine ${i + 1} name`} />
                {form.medicines.length > 1 && (
                  <button type="button" onClick={() => set('medicines', form.medicines.filter((_, j) => j !== i))} className="px-2 text-sm" style={{ color: '#94A3B8' }} aria-label={`Remove medicine ${i + 1}`}>
                    <i className="ri-delete-bin-line" />
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input type="number" min={0} step="any" required placeholder="Amount" value={m.quantity} onChange={e => setMedicine(i, 'quantity', e.target.value)} className="w-24 px-2 py-1.5 text-xs outline-none" style={inputStyle} aria-label={`Medicine ${i + 1} amount per pickup`} />
                <select value={m.unit} onChange={e => setMedicine(i, 'unit', e.target.value)} className="px-2 py-1.5 text-xs outline-none cursor-pointer" style={inputStyle} aria-label={`Medicine ${i + 1} unit`}>
                  {MEDICINE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
                <input placeholder="How to take (e.g. 4 tablets daily)" value={m.instructions} onChange={e => setMedicine(i, 'instructions', e.target.value)} className="min-w-0 flex-1 px-2 py-1.5 text-xs outline-none" style={inputStyle} aria-label={`Medicine ${i + 1} instructions`} />
              </div>
            </div>
          ))}
        </div>
        {schedule && <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>Changes apply to the next pickups; pickups already recorded keep what was given.</p>}
      </div>

      <label className="block">
        <span className="block text-xs font-bold mb-1" style={{ color: '#0F2D52' }}>Notes</span>
        <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} maxLength={500} className="w-full px-3 py-2 text-xs outline-none" style={inputStyle} />
      </label>

      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} disabled={saving} className="px-4 py-2 text-xs font-medium" style={secondaryBtn}>Cancel</button>}
        <button type="submit" disabled={saving} className="px-4 py-2 text-xs font-semibold disabled:opacity-50" style={primaryBtn}>
          {saving ? 'Saving…' : schedule ? 'Save changes' : 'Assign schedule'}
        </button>
      </div>
    </form>
  );
}

/* ─── Patient panel: schedule, warnings and pickups ─── */

function PickupRow({ pickup, editable, busy, onRecord }) {
  const s = PICKUP_STATE[pickup.state];
  const recorded = pickup.state === 'collected' || pickup.state === 'missed';
  const canRecord = editable && pickup.state !== 'upcoming';
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5" style={{ borderTop: '1px solid #F1F5F9' }}>
      <span className="w-24 text-xs font-semibold" style={{ color: '#0F2D52' }}>{fmtDate(pickup.date)}</span>
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: s.bg, color: s.color }}>
        <i className={s.icon} aria-hidden="true" />{s.label}
      </span>
      {pickup.state === 'collected' && pickup.collected_on && pickup.collected_on !== pickup.date && (
        <span className="text-[10px]" style={{ color: '#64748B' }}>on {fmtDate(pickup.collected_on)}</span>
      )}
      {canRecord && (
        <span className="ml-auto flex gap-1.5">
          {recorded ? (
            <button type="button" disabled={busy} onClick={() => onRecord(pickup.date, null)} className="px-2 py-1 text-[10px] font-semibold disabled:opacity-50" style={secondaryBtn}>Undo</button>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => onRecord(pickup.date, 'collected')} className="px-2 py-1 text-[10px] font-semibold disabled:opacity-50" style={{ background: '#047857', color: '#ffffff', borderRadius: 4 }}>Collected</button>
              <button type="button" disabled={busy} onClick={() => onRecord(pickup.date, 'missed')} className="px-2 py-1 text-[10px] font-semibold disabled:opacity-50" style={{ background: '#ffffff', color: '#991B1B', border: '1px solid #FCA5A5', borderRadius: 4 }}>Missed</button>
            </>
          )}
        </span>
      )}
    </li>
  );
}

function PatientPanel({ patientId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    try {
      const res = await API.get(`/api/data/medication/${patientId}`);
      setData(res.data);
      setError('');
    } catch (err) {
      setError(errorText(err, 'Could not load this patient.'));
    }
  }, [patientId]);
  useEffect(() => { load(); }, [load]);

  const changed = (message) => { setNotice(message); setEditing(false); load(); onChanged(); };

  const record = async (date, status) => {
    setBusy(true);
    setNotice('');
    try {
      const res = await API.put(`/api/data/medication/schedules/${data.schedule.id}/pickups/${date}`, { status });
      changed(res.data.message);
    } catch (err) {
      setNotice(errorText(err, 'Could not record the pickup.'));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    const ok = await confirm({
      title: 'Stop this schedule?',
      message: 'No more pickups will be expected. The schedule and its pickups are kept as history.',
      confirmLabel: 'Stop schedule',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await API.post(`/api/data/medication/schedules/${data.schedule.id}/stop`);
      changed(res.data.message);
    } catch (err) {
      setNotice(errorText(err, 'Could not stop the schedule.'));
    }
  };

  const patient = data?.patient;
  const schedule = data?.schedule;
  const editable = can(patient, 'edit');
  const past = schedule ? schedule.pickups.filter(p => p.state !== 'upcoming').reverse() : [];
  const upcoming = schedule ? schedule.pickups.filter(p => p.state === 'upcoming').slice(0, 3) : [];
  const shownPast = showAllPast ? past : past.slice(0, 8);

  return (
    <SidePanel
      title={patient ? caseIdLabel(patient) : 'Medication schedule'}
      subtitle={patient ? `${patientName(patient)} · ${patient.responsible_barangay || patient.barangay_name || '—'}` : undefined}
      badge={schedule ? <WarningBadge level={schedule.level} missed={schedule.missed} /> : null}
      onClose={onClose}
    >
      {error && <p role="alert" className="rounded px-3 py-2 text-xs" style={{ background: '#FEF2F2', color: '#991B1B' }}>{error}</p>}
      {!data && !error && <div className="space-y-3"><SkeletonBlock className="h-16" /><SkeletonBlock className="h-40" /></div>}
      {notice && <p className="rounded px-3 py-2 text-xs font-semibold" style={{ background: '#F1F5F9', color: '#0F2D52' }}>{notice}</p>}

      {data && !editable && (
        <p className="rounded px-3 py-2 text-[11px]" style={{ background: '#F8FAFC', color: '#64748B', border: '1px solid #E2E8F0' }}>
          <i className="ri-eye-line mr-1" />View only — {patient.responsible_barangay && patient.responsible_barangay !== patient.barangay_name ? `${patient.responsible_barangay} handles this patient.` : 'you cannot change this patient\'s schedule.'}
        </p>
      )}

      {data && !schedule && (editable
        ? <ScheduleForm patientId={patientId} today={data.today} onSaved={changed} />
        : <EmptyState icon="ri-calendar-line" title="No schedule yet" description="The barangay handling this patient has not assigned a pickup schedule." />)}

      {data && schedule && editing && (
        <ScheduleForm patientId={patientId} schedule={schedule} today={data.today} onSaved={changed} onCancel={() => setEditing(false)} />
      )}

      {data && schedule && !editing && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Missed', schedule.missed, schedule.missed >= 3 ? '#991B1B' : schedule.missed > 0 ? '#92400E' : '#047857'],
              ['Collected', `${schedule.collected} / ${schedule.total}`, '#0F2D52'],
              ['Next pickup', schedule.next_pickup ? fmtDate(schedule.next_pickup) : 'Finished', '#0F2D52'],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded px-3 py-2" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#94A3B8' }}>{label}</p>
                <p className="text-sm font-extrabold mt-0.5" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>

          <div className="rounded p-3 text-xs space-y-1.5" style={{ border: '1px solid #E2E8F0' }}>
            <div className="flex items-center justify-between">
              <p className="font-bold" style={{ color: '#0F2D52' }}>{intervalLabel(schedule.interval_days)} · {fmtDate(schedule.start_date)} – {fmtDate(schedule.end_date)}</p>
              {editable && (
                <span className="flex gap-3">
                  <button type="button" onClick={() => { setEditing(true); setNotice(''); }} className="text-[11px] font-semibold" style={{ color: '#2E6FAF' }}>Edit</button>
                  <button type="button" onClick={stop} className="text-[11px] font-semibold" style={{ color: '#B91C1C' }}>Stop</button>
                </span>
              )}
            </div>
            <ul className="space-y-0.5" style={{ color: '#334155' }}>
              {schedule.medicines.map((m, i) => <li key={i}><i className="ri-capsule-line mr-1" style={{ color: '#94A3B8' }} />{medicineLine(m)}</li>)}
            </ul>
            {schedule.notes && <p style={{ color: '#64748B' }}>{schedule.notes}</p>}
            <p className="text-[10px]" style={{ color: '#94A3B8' }}>
              Assigned by {schedule.created_by_name || 'unknown'}{schedule.updated_by_name && schedule.updated_at !== schedule.created_at ? ` · last changed by ${schedule.updated_by_name}` : ''}
            </p>
          </div>

          <p className="text-[10px] leading-relaxed" style={{ color: '#64748B' }}>
            A pickup not collected {data.grace_days} days after its date counts as missed. 1st and 2nd missed pickups are a yellow warning; the 3rd is red.
          </p>

          <div className="rounded overflow-hidden" style={{ border: '1px solid #E2E8F0' }}>
            <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ background: '#F8FAFC', color: '#64748B' }}>Pickups</p>
            <ul>
              {upcoming.slice().reverse().map(p => <PickupRow key={p.date} pickup={p} editable={editable} busy={busy} onRecord={record} />)}
              {shownPast.map(p => <PickupRow key={p.date} pickup={p} editable={editable} busy={busy} onRecord={record} />)}
            </ul>
            {past.length > shownPast.length && (
              <button type="button" onClick={() => setShowAllPast(true)} className="w-full px-3 py-2 text-[11px] font-semibold" style={{ borderTop: '1px solid #F1F5F9', color: '#2E6FAF' }}>
                Show all {past.length} past pickups
              </button>
            )}
          </div>
        </>
      )}

      {data?.history?.length > 0 && (
        <div className="text-[11px]" style={{ color: '#64748B' }}>
          <p className="font-bold uppercase tracking-wider text-[10px] mb-1">Stopped schedules</p>
          {data.history.map(h => (
            <p key={h.id}>{intervalLabel(h.interval_days)} from {fmtDate(h.start_date)} · stopped {h.stopped_at ? new Date(h.stopped_at).toLocaleDateString() : ''}{h.stopped_by_name ? ` by ${h.stopped_by_name}` : ''}</p>
          ))}
        </div>
      )}
      {confirmDialog}
    </SidePanel>
  );
}

/* ─── Page ─── */

export default function MedicationSchedulePage() {
  const [level, setLevel] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/data/medication', { params: { level: level || undefined, search: search || undefined, page, limit: pageSize } });
      setData(res.data);
      setError('');
    } catch (err) {
      setError(errorText(err, 'Failed to load medication schedules.'));
    } finally {
      setLoading(false);
    }
  }, [level, search, page, pageSize]);
  useEffect(() => { load(); }, [load]);

  const counts = data?.counts || {};
  const patients = data?.patients || [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
        <div className="px-6 py-5" style={{ borderBottom: '1px solid #E2E8F0' }}>
          <h1 className="text-lg font-bold" style={{ color: '#0F2D52' }}>Medication Schedule</h1>
          <p className="mt-1 text-xs" style={{ color: '#64748B' }}>
            Medicine pickups at the health center for patients on treatment. 1st and 2nd missed pickups are a yellow warning; the 3rd is red.
          </p>
        </div>

        <div className="flex gap-0 overflow-x-auto" style={{ borderBottom: '1px solid #E2E8F0' }}>
          {TABS.map(tab => {
            const active = level === tab.key;
            const n = counts[tab.countKey] || 0;
            return (
              <button key={tab.key || 'all'} type="button" aria-pressed={active} onClick={() => { setLevel(tab.key); setPage(1); }}
                className="relative px-6 py-3 text-left whitespace-nowrap transition-colors hover:bg-[#F8FAFC]"
                style={{ background: active ? '#F8FAFC' : 'transparent' }}>
                <p className="flex items-center text-[13px] font-bold" style={{ color: active ? '#0F2D52' : '#334155' }}>
                  {tab.dot && <span className="mr-1.5 h-2.5 w-2.5 rounded-full" style={{ background: tab.dot }} aria-hidden="true" />}
                  {tab.title}
                  {n > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[22px] h-5 rounded-full text-[10px] font-bold px-1.5" style={{ background: tab.toneBg || '#E2E8F0', color: tab.tone || '#334155' }}>
                      {n.toLocaleString()}
                    </span>
                  )}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: active ? '#475569' : '#64748B' }}>{tab.desc}</p>
                {active && <div className="absolute bottom-0 left-0 right-0 h-[3px]" style={{ background: tab.dot && tab.key !== 'none' ? tab.dot : '#0F2D52' }} />}
              </button>
            );
          })}
        </div>

        <div className="px-6 py-3 flex flex-wrap gap-3 items-center" style={{ background: '#F8FAFC' }}>
          <div className="relative w-full max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#94A3B8' }} />
            <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search Case ID or barangay..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg outline-none" style={{ background: '#ffffff', border: '1px solid #E2E8F0', color: '#0F2D52' }} />
          </div>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #E2E8F0', boxShadow: '0 4px 16px rgba(15,23,42,0.04)' }}>
        {loading && !data ? (
          <div className="p-4 space-y-3"><SkeletonBlock className="h-10" /><SkeletonBlock className="h-64" /></div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : patients.length === 0 ? (
          <EmptyState icon="ri-capsule-line" title="No patients found" description={level ? 'No patients on treatment are in this group.' : 'There are no patients on treatment matching your search.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ borderCollapse: 'collapse' }}>
              <thead style={{ background: '#0F2D52' }}>
                <tr>
                  {['Case ID', 'Patient', 'Barangay', 'Medicines', 'Schedule', 'Next pickup', 'Missed', 'Status', ''].map((label, i, all) => (
                    <th key={label || 'action'} className={`${i === 0 ? 'pl-4' : 'px-2'} py-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap text-white`}
                      style={{ borderRight: i < all.length - 1 ? '1px solid #1E40AF' : 'none' }}>
                      {label || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {patients.map((p, i) => {
                  const next = p.next_pickup ? PICKUP_STATE[p.next_state] : null;
                  return (
                    <tr key={p.id} className={`hover:bg-blue-50 transition-colors cursor-pointer ${i % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'}`} style={{ borderBottom: '1px solid #E2E8F0' }} onClick={() => setOpenId(p.id)}>
                      <td className="pl-4 pr-2 py-2.5 text-[11px] font-mono font-bold whitespace-nowrap" style={{ color: '#0F2D52' }}>{caseIdLabel(p)}</td>
                      <td className="px-2 py-2.5 text-[11px] font-semibold whitespace-nowrap" style={{ color: '#0F2D52' }}>{patientName(p, { short: true })}</td>
                      <td className="px-2 py-2.5 text-[11px]" style={{ color: '#334155' }}>{p.responsible_barangay || p.barangay_name || '—'}</td>
                      <td className="px-2 py-2.5 text-[11px] max-w-[220px] truncate" style={{ color: '#334155' }} title={(p.medicines || []).map(medicineLine).join('\n') || undefined}>
                        {p.schedule_id ? (p.medicines || []).map(m => m.name).join(', ') : '—'}
                      </td>
                      <td className="px-2 py-2.5 text-[11px] whitespace-nowrap" style={{ color: '#334155' }}>
                        {p.schedule_id ? <>{intervalLabel(p.interval_days)}<span className="block text-[10px]" style={{ color: '#94A3B8' }}>until {fmtDate(p.end_date)}</span></> : '—'}
                      </td>
                      <td className="px-2 py-2.5 text-[11px] whitespace-nowrap" style={{ color: '#334155' }}>
                        {next ? <>{fmtDate(p.next_pickup)}{p.next_state !== 'upcoming' && <span className="block text-[10px] font-semibold" style={{ color: next.color }}>{next.label}</span>}</> : p.schedule_id ? 'Finished' : '—'}
                      </td>
                      <td className="px-2 py-2.5 text-[11px] font-bold" style={{ color: p.missed >= 3 ? '#991B1B' : p.missed > 0 ? '#92400E' : '#334155' }}>{p.schedule_id ? p.missed : '—'}</td>
                      <td className="px-2 py-2.5"><WarningBadge level={p.level} missed={p.missed} /></td>
                      <td className="px-2 py-2.5 text-right pr-4 whitespace-nowrap">
                        {!p.schedule_id && can(p, 'edit') ? (
                          <button type="button" onClick={e => { e.stopPropagation(); setOpenId(p.id); }} className="px-2.5 py-1 text-[10px] font-semibold" style={primaryBtn}>Assign</button>
                        ) : (
                          <button type="button" onClick={e => { e.stopPropagation(); setOpenId(p.id); }} className="px-2.5 py-1 text-[10px] font-semibold" style={secondaryBtn}>Open</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && !error && (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={data.pagination.total}
            itemName="patients"
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        )}
      </div>

      {openId && <PatientPanel key={openId} patientId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
