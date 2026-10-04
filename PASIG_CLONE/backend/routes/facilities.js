const express = require('express');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { logAuditEvent } = require('../utils/auditLogger');
// TBInsight's DB (AUTH_DATABASE_URL), where health_facilities live — shared pool, so it
// reuses already-open connections instead of opening its own.
const { authPool, pool } = require('../db/pasigSchema');
const { syncFacilityRef, refreshFacilityIds } = require('../services/barangayRegistry');
const { suggestFacility, LIVE, normFacility } = require('../services/validationQueue');
const { facilityPermissions } = require('../policies/permissions');

const router = express.Router();

const FACILITY_TYPES = ['HC', 'PC', 'ITC', 'Floodway'];
const CLASSIFICATIONS = ['pasig', 'external'];
const STATUSES = ['active', 'inactive'];

/**
 * Shared POST/PUT body validation. Returns { error } or { fields }.
 * extended: ownership (public/private) is accepted — both POST and PUT pass it.
 */
function parseFacilityInput(body, { extended = false } = {}) {
  const name = String(body?.name || '').trim();
  const facilityType = String(body?.facility_type || '').trim();
  const barangayName = String(body?.barangay_name || '').trim();
  const address = String(body?.address || '').trim() || null;
  const classification = String(body?.classification || 'pasig').trim().toLowerCase();
  const status = String(body?.status || 'active').trim().toLowerCase();
  const city = String(body?.city || '').trim();

  if (!name) return { error: 'Facility name is required.' };
  if (!FACILITY_TYPES.includes(facilityType)) return { error: 'Please select a valid facility type.' };
  if (!CLASSIFICATIONS.includes(classification)) return { error: 'Classification must be pasig or external.' };
  if (!STATUSES.includes(status)) return { error: 'Status must be active or inactive.' };

  let ownership = null;
  let contactNumber = null;
  const notes = String(body?.notes ?? '').trim() || null;
  if (extended) {
    const own = String(body?.ownership ?? '').trim().toLowerCase();
    if (own && !['public', 'private'].includes(own)) return { error: 'Ownership must be public or private.' };
    ownership = own || null;
    const contact = String(body?.contact_number ?? '').trim();
    if (contact.length > 50) return { error: 'Contact number must be 50 characters or fewer.' };
    contactNumber = contact || null;
  }

  return {
    fields: {
      name, facilityType, barangayName, address, classification, status, city,
      isExternal: classification === 'external',
      isActive: status === 'active',
      ownership, notes, contactNumber,
    },
  };
}

/**
 * Duplicate guard stronger than the DB unique indexes: those compare exact strings, so
 * "Rosario HC" vs "rosario hc - IDOTS" would both slip through. Same scope as the
 * indexes — same barangay for Pasig facilities, the NULL-barangay set for external ones
 * — but compared on norm_facility() so case, punctuation and program-tag variants of one
 * name are caught before anything is written.
 */
async function findDuplicateName(name, { isExternal, barangay, excludeId = null }) {
  const norm = normFacility(name);
  if (!norm) return null;
  const rows = (await authPool.query('SELECT id, name, barangay_name FROM health_facilities')).rows;
  return rows.find(r =>
    Number(r.id) !== Number(excludeId ?? -1) &&
    normFacility(r.name) === norm &&
    (isExternal
      ? !r.barangay_name
      : Boolean(r.barangay_name) && String(r.barangay_name).toLowerCase() === String(barangay || '').toLowerCase())
  ) || null;
}

/**
 * An alias must not shadow a DIFFERENT facility's canonical name — records naming it
 * would silently land on the wrong facility (directory and queue paths share this rule).
 */
async function findCanonicalNameClash(aliasNorm, excludeId) {
  const rows = (await authPool.query('SELECT id, name FROM health_facilities WHERE id <> $1', [excludeId])).rows;
  return rows.find(r => Number(r.id) !== Number(excludeId) && normFacility(r.name) === aliasNorm) || null;
}

/** Look the barangay up by name. Returns { error } or { barangay, barangayId }. */
async function resolveBarangay(barangayName) {
  if (!barangayName) return { error: 'Barangay is required.' };
  const r = await authPool.query('SELECT id, name FROM barangays WHERE name = $1', [barangayName]);
  if (!r.rows.length) return { error: 'Unknown barangay.' };
  return { barangay: r.rows[0].name, barangayId: r.rows[0].id };
}

async function listAliases(id) {
  const r = await pool.query(
    'SELECT alias_norm, alias_text, created_at FROM facility_aliases WHERE facility_id = $1 ORDER BY alias_text ASC',
    [id],
  );
  return r.rows;
}

/**
 * After an alias change, recompute case facility ids right away so imported records
 * resolve (or stop resolving) immediately — not up to 10 minutes later when the
 * background refresh next runs. Failure here never fails the alias operation itself:
 * the alias is saved either way and the background refresh will catch up.
 */
async function reResolveCaseFacilityIds() {
  try {
    await refreshFacilityIds(pool);
  } catch (err) {
    console.error('Could not refresh case facility ids after alias change:', err.message);
  }
}

/**
 * GET /api/facilities
 * Returns health facilities grouped by barangay, plus all barangays, plus the caller's
 * facility permissions (the frontend mirrors them instead of re-deriving a role).
 * Roles: admin and staff — the directory is read-only for staff.
 * ?status=active (default) | inactive | all — default keeps every existing
 * consumer (TB Records, Users) on active-only rows.
 */
router.get('/', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const status = req.query.status || 'active';
    if (!['active', 'inactive', 'all'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter. Use active, inactive or all.' });
    }
    const statusWhere = status === 'all' ? ''
      : status === 'inactive'
        ? `WHERE NOT COALESCE((to_jsonb(h)->>'is_active')::boolean, TRUE)`
        : `WHERE COALESCE((to_jsonb(h)->>'is_active')::boolean, TRUE)`;

    // Both lookups at once (each is a ~0.2 s round trip to the remote database).
    // to_jsonb(h)->>'address' reads the address column if it exists and gives NULL if it
    // doesn't — one query, instead of a failing query followed by a fallback.
    // to_jsonb(...)->> reads columns added by TBInsight migration 023 (barangay id,
    // ownership, category, external/reference flags) and yields NULL before it has run.
    const [barangaysResult, facilitiesResult] = await Promise.all([
      authPool.query(`
        SELECT (to_jsonb(b)->>'id')::int AS id, b.name, b.population
        FROM barangays b
        WHERE COALESCE((to_jsonb(b)->>'is_active')::boolean, TRUE)
        ORDER BY b.name ASC`),
      authPool.query(`
        SELECT h.id, h.name, h.barangay_name, h.facility_type,
               to_jsonb(h)->>'address' AS address,
               (to_jsonb(h)->>'barangay_id')::int AS barangay_id,
               to_jsonb(h)->>'ownership' AS ownership,
               to_jsonb(h)->>'facility_category' AS facility_category,
               COALESCE((to_jsonb(h)->>'is_external')::boolean, FALSE) AS is_external,
               COALESCE((to_jsonb(h)->>'is_reference')::boolean, FALSE) AS is_reference,
               COALESCE((to_jsonb(h)->>'is_active')::boolean, TRUE) AS is_active,
               to_jsonb(h)->>'city' AS city,
               to_jsonb(h)->>'contact_number' AS contact_number,
               to_jsonb(h)->>'facility_code' AS facility_code,
               to_jsonb(h)->>'notes' AS notes,
               (to_jsonb(h)->>'created_at')::timestamptz AS created_at,
               (to_jsonb(h)->>'updated_at')::timestamptz AS updated_at
        FROM health_facilities h
        ${statusWhere}
        ORDER BY h.barangay_name ASC NULLS LAST, h.name ASC
      `),
    ]);

    const rows = facilitiesResult.rows;

    // Group facilities by barangay
    const byBarangay = {};
    for (const row of rows) {
      // External facilities (outside Pasig) have no barangay.
      const key = row.barangay_name || 'External';
      if (!byBarangay[key]) {
        byBarangay[key] = [];
      }
      byBarangay[key].push({
        id: row.id,
        name: row.name,
        facility_type: row.facility_type,
        address: row.address,
        ownership: row.ownership,
        facility_category: row.facility_category,
        is_external: row.is_external,
        is_reference: row.is_reference,
        is_active: row.is_active,
        city: row.city,
        contact_number: row.contact_number,
      });
    }

    res.json({
      total: rows.length,
      barangays: barangaysResult.rows,
      barangay_count: barangaysResult.rows.length,
      facilities: rows,
      by_barangay: byBarangay,
      permissions: facilityPermissions(req.user),
    });
  } catch (err) {
    console.error('Error fetching facilities:', err.message);
    res.status(500).json({ error: 'Failed to fetch health facilities.' });
  }
});

/**
 * GET /api/facilities/:id/aliases — admin and staff: the alias list is part of the
 * facility details staff may read; only admins mutate it (routes below).
 * facility_aliases lives in the validation DB.
 */
router.get('/:id/aliases', authenticate, authorizeRoles('admin', 'staff'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid facility id.' });
    res.json({ aliases: await listAliases(id) });
  } catch (err) {
    console.error('Error fetching facility aliases:', err.message);
    res.status(500).json({ error: 'Failed to fetch aliases.' });
  }
});

/**
 * GET /api/facilities/:id/alias-suggestions — ADMIN ONLY: unresolved names + record
 * counts are the input to alias management, so they go with the aliases permission
 * (staff still read the directory, details and the alias list itself).
 *
 * Distinct facility names sitting unresolved in imported records that the token
 * matcher believes belong to THIS facility, with the number of record fields using
 * each one. Grouping happens on norm_facility(), so tag/case variants of one name
 * ("ROSARIO HEALTH CENTER - IDOTS" / "… - MTBN") arrive as a single suggestion.
 * Names that match no registry facility at all (unregistered private/external) are
 * not shown here — they belong in Validation → Needs Assignment.
 */
router.get('/:id/alias-suggestions', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid facility id.' });
    const facility = (await authPool.query('SELECT id, name FROM health_facilities WHERE id = $1', [id])).rows[0];
    if (!facility) return res.status(404).json({ error: 'Facility not found.' });

    const [namesResult, registryResult] = await Promise.all([
      pool.query(
        `SELECT MAX(t) AS alias_text, SUM(n)::int AS "records"
         FROM (
           SELECT treatment_facility AS t, COUNT(*)::int AS n
           FROM validated_tb_cases v
           WHERE ${LIVE} AND NULLIF(trim(v.treatment_facility), '') IS NOT NULL
             AND v.treatment_facility_id IS NULL
           GROUP BY 1
           UNION ALL
           SELECT screening_facility AS t, COUNT(*)::int AS n
           FROM validated_tb_cases v
           WHERE ${LIVE} AND NULLIF(trim(v.screening_facility), '') IS NOT NULL
             AND v.screening_facility_id IS NULL
           GROUP BY 1
         ) x
         GROUP BY norm_facility(t)
         ORDER BY "records" DESC
         LIMIT 100`
      ),
      pool.query('SELECT id, name FROM facility_ref'),
    ]);

    const suggestions = namesResult.rows
      .map(r => ({ ...r, suggestion: suggestFacility(r.alias_text, registryResult.rows) }))
      .filter(r => r.suggestion && r.suggestion.id === id)
      .map(r => ({ alias_text: r.alias_text, records: r.records }));

    res.json({ suggestions });
  } catch (err) {
    console.error('Error fetching alias suggestions:', err.message);
    res.status(500).json({ error: 'Failed to fetch alias suggestions.' });
  }
});

/**
 * POST /api/facilities/:id/aliases — admin only. Adds one more spelling of the
 * facility name; every alias maps to this same canonical facility_id.
 */
router.post('/:id/aliases', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid facility id.' });
    const aliasText = String(req.body?.alias_text || '').trim();
    if (!aliasText) return res.status(400).json({ error: 'Alias is required.' });
    const aliasNorm = normFacility(aliasText);
    if (!aliasNorm) return res.status(400).json({ error: 'Alias must contain letters or numbers.' });

    const facility = (await authPool.query('SELECT id, name FROM health_facilities WHERE id = $1', [id])).rows[0];
    if (!facility) return res.status(404).json({ error: 'Facility not found.' });
    if (aliasNorm === normFacility(facility.name)) {
      return res.status(400).json({ error: 'This is already the facility\u2019s name.' });
    }
    const clash = await findCanonicalNameClash(aliasNorm, id);
    if (clash) {
      return res.status(409).json({ error: 'This name is already used by another facility.' });
    }

    try {
      await pool.query(
        `INSERT INTO facility_aliases (alias_norm, alias_text, facility_id, created_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        [aliasNorm, aliasText, id, req.user.id],
      );
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'This alias is already mapped to a facility.' });
      }
      throw err;
    }

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'FACILITY_ALIAS_ADD',
      resourceType: 'facility',
      resourceId: id,
      result: 'SUCCESS',
      ipAddress: req.ip,
      actorRole: req.user.role,
      details: { alias: aliasText },
    });
    await reResolveCaseFacilityIds();
    res.status(201).json({ aliases: await listAliases(id) });
  } catch (err) {
    console.error('Error adding facility alias:', err.message);
    res.status(500).json({ error: 'Failed to add alias.' });
  }
});

/**
 * DELETE /api/facilities/:id/aliases/:aliasNorm — admin only. Removing an alias
 * is an explicit choice: raw historical text that only matched through it may
 * stop resolving (the UI confirms before calling).
 */
router.delete('/:id/aliases/:aliasNorm', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid facility id.' });
    const aliasNorm = String(req.params.aliasNorm || '').toLowerCase().trim();
    if (!aliasNorm) return res.status(400).json({ error: 'Invalid alias.' });

    const r = await pool.query(
      'DELETE FROM facility_aliases WHERE alias_norm = $1 AND facility_id = $2',
      [aliasNorm, id],
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Alias not found.' });

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'FACILITY_ALIAS_REMOVE',
      resourceType: 'facility',
      resourceId: id,
      result: 'SUCCESS',
      ipAddress: req.ip,
      actorRole: req.user.role,
      details: { alias_norm: aliasNorm },
    });
    await reResolveCaseFacilityIds();
    res.json({ aliases: await listAliases(id) });
  } catch (err) {
    console.error('Error removing facility alias:', err.message);
    res.status(500).json({ error: 'Failed to remove alias.' });
  }
});

/**
 * PUT /api/facilities/:id/aliases/:aliasNorm — admin only. Corrects a wrong
 * alias: the text and its normalized key are rewritten in place, keeping the
 * same facility_id (aliases never point anywhere else).
 */
router.put('/:id/aliases/:aliasNorm', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid facility id.' });
    const aliasNorm = String(req.params.aliasNorm || '').toLowerCase().trim();
    if (!aliasNorm) return res.status(400).json({ error: 'Invalid alias.' });
    const aliasText = String(req.body?.alias_text || '').trim();
    if (!aliasText) return res.status(400).json({ error: 'Alias is required.' });
    const newNorm = normFacility(aliasText);
    if (!newNorm) return res.status(400).json({ error: 'Alias must contain letters or numbers.' });

    const facility = (await authPool.query('SELECT id, name FROM health_facilities WHERE id = $1', [id])).rows[0];
    if (!facility) return res.status(404).json({ error: 'Facility not found.' });
    if (newNorm === normFacility(facility.name)) {
      return res.status(400).json({ error: 'This is already the facility\u2019s name.' });
    }
    const clash = await findCanonicalNameClash(newNorm, id);
    if (clash) {
      return res.status(409).json({ error: 'This name is already used by another facility.' });
    }

    let r;
    try {
      r = await pool.query(
        'UPDATE facility_aliases SET alias_text = $1, alias_norm = $2 WHERE alias_norm = $3 AND facility_id = $4',
        [aliasText, newNorm, aliasNorm, id],
      );
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'This alias is already mapped to a facility.' });
      }
      throw err;
    }
    if (!r.rowCount) return res.status(404).json({ error: 'Alias not found.' });

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'FACILITY_ALIAS_UPDATE',
      resourceType: 'facility',
      resourceId: id,
      result: 'SUCCESS',
      ipAddress: req.ip,
      actorRole: req.user.role,
      details: { from: aliasNorm, to: aliasText },
    });
    await reResolveCaseFacilityIds();
    res.json({ aliases: await listAliases(id) });
  } catch (err) {
    console.error('Error updating facility alias:', err.message);
    res.status(500).json({ error: 'Failed to update alias.' });
  }
});

/**
 * POST /api/facilities — admin only. Adds a reference facility used by TB
 * records, imports and validation. Staff have no create path (view-only).
 *
 * classification: 'pasig' (default) — links barangay_id + barangay_name;
 * 'external' — outside Pasig: barangay stays NULL, city required instead.
 * status: 'active' (default) | 'inactive' → is_active.
 * ownership: 'public' | 'private' (optional).
 */
router.post('/', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const parsed = parseFacilityInput(req.body, { extended: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const f = parsed.fields;
    if (f.isExternal && !f.city) {
      return res.status(400).json({ error: 'City is required for external facilities.' });
    }

    let barangay = null;
    let barangayId = null;
    if (!f.isExternal) {
      const resolved = await resolveBarangay(f.barangayName);
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      barangay = resolved.barangay;
      barangayId = resolved.barangayId;
    }

    const duplicate = await findDuplicateName(f.name, { isExternal: f.isExternal, barangay });
    if (duplicate) {
      return res.status(409).json({ error: 'A facility with this name already exists.' });
    }

    const insertResult = await authPool.query(
      `INSERT INTO health_facilities
         (name, facility_type, barangay_name, barangay_id, address, is_active, is_external, is_reference, city, notes, ownership, contact_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11)
       RETURNING id, name, barangay_name, facility_type, address, ownership, barangay_id, is_active,
                 is_external, is_reference, city, notes, contact_number, created_at`,
      [f.name, f.facilityType, barangay, barangayId, f.address, f.isActive, f.isExternal,
        f.isExternal ? (f.city || null) : 'Pasig City', f.notes, f.ownership, f.contactNumber],
    );
    const facility = insertResult.rows[0];

    // Mirror into facility_ref right away so validation mapping sees the facility
    // now (barangayRegistry also re-runs the same sync every 10 minutes).
    await syncFacilityRef(authPool, pool);

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'FACILITY_CREATE',
      resourceType: 'facility',
      resourceId: facility.id,
      result: 'SUCCESS',
      ipAddress: req.ip,
      actorRole: req.user.role,
      details: {
        name: f.name, facility_type: f.facilityType, classification: f.classification, status: f.status,
        barangay_name: barangay, city: facility.city, ownership: f.ownership, notes: f.notes,
      },
    });

    res.status(201).json({ facility });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A facility with this name already exists.' });
    }
    console.error('Error creating facility:', err.message);
    res.status(500).json({ error: 'Failed to add facility.' });
  }
});

/**
 * PUT /api/facilities/:id — admin only. Edits the canonical facility record.
 * Never touches the raw facility text stored on historical imported cases:
 * only health_facilities (and the facility_ref mirror) are written. A rename
 * keeps the OLD name as an alias so raw historical text keeps resolving to
 * this same facility_id.
 */
router.put('/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid facility id.' });

    const current = (await authPool.query(
      `SELECT id, name, barangay_name, facility_type, address, is_active, is_external,
              ownership, notes, city, contact_number
       FROM health_facilities WHERE id = $1`,
      [id],
    )).rows[0];
    if (!current) return res.status(404).json({ error: 'Facility not found.' });

    // Merge semantics: a key the caller omits keeps its current value — a partial PUT
    // must never silently null a column (the frontend sends every key; API callers
    // may not). name / facility_type are merged too, so the required checks still
    // guard against genuinely empty rows.
    const src = (req.body && typeof req.body === 'object') ? req.body : {};
    const has = (k) => Object.prototype.hasOwnProperty.call(src, k);
    const body = { ...src };
    if (!has('name')) body.name = current.name;
    if (!has('facility_type')) body.facility_type = current.facility_type || '';
    if (!has('classification')) body.classification = current.is_external ? 'external' : 'pasig';
    if (!has('status')) body.status = current.is_active !== false ? 'active' : 'inactive';
    if (!has('barangay_name')) body.barangay_name = current.barangay_name || '';
    if (!has('city')) body.city = current.city || '';
    if (!has('address')) body.address = current.address || '';
    if (!has('ownership')) body.ownership = current.ownership || '';
    if (!has('notes')) body.notes = current.notes || '';
    if (!has('contact_number')) body.contact_number = current.contact_number || '';

    const parsed = parseFacilityInput(body, { extended: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const f = parsed.fields;
    if (f.isExternal && !f.city) {
      return res.status(400).json({ error: 'City is required for external facilities.' });
    }

    let barangay = null;
    let barangayId = null;
    if (!f.isExternal) {
      const resolved = await resolveBarangay(f.barangayName);
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      barangay = resolved.barangay;
      barangayId = resolved.barangayId;
    }
    const city = f.isExternal ? (f.city || null) : 'Pasig City';

    const duplicate = await findDuplicateName(f.name, { isExternal: f.isExternal, barangay, excludeId: id });
    if (duplicate) {
      return res.status(409).json({ error: 'A facility with this name already exists.' });
    }

    const updated = await authPool.query(
      `UPDATE health_facilities
          SET name = $2, facility_type = $3, barangay_name = $4, barangay_id = $5, address = $6,
              is_active = $7, is_external = $8, is_reference = $8, city = $9,
              ownership = $10, notes = $11, contact_number = $12, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, f.name, f.facilityType, barangay, barangayId, f.address, f.isActive, f.isExternal,
        city, f.ownership, f.notes, f.contactNumber],
    );
    const facility = updated.rows[0];

    // Preserve historical references: case rows keep their original raw facility
    // text, resolved through facility_aliases first. If the name changed, park the
    // pre-rename name as an alias of this same id (ON CONFLICT: never steal one).
    if (normFacility(current.name) !== normFacility(facility.name)) {
      await pool.query(
        `INSERT INTO facility_aliases (alias_norm, alias_text, facility_id)
         VALUES ($1, $2, $3) ON CONFLICT (alias_norm) DO NOTHING`,
        [normFacility(current.name), current.name, id],
      );
    }

    await syncFacilityRef(authPool, pool);

    const changed = {};
    const put = (key, oldV, newV) => {
      if (String(oldV ?? '') !== String(newV ?? '')) changed[key] = { old: oldV ?? null, new: newV ?? null };
    };
    put('name', current.name, facility.name);
    put('facility_type', current.facility_type, facility.facility_type);
    put('classification', current.is_external ? 'external' : 'pasig', f.isExternal ? 'external' : 'pasig');
    put('barangay_name', current.barangay_name, facility.barangay_name);
    put('address', current.address, facility.address);
    put('city', current.city, facility.city);
    put('ownership', current.ownership, facility.ownership);
    put('notes', current.notes, facility.notes);
    put('contact_number', current.contact_number, facility.contact_number);
    put('status', current.is_active ? 'active' : 'inactive', facility.is_active ? 'active' : 'inactive');

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'FACILITY_UPDATE',
      resourceType: 'facility',
      resourceId: id,
      result: 'SUCCESS',
      ipAddress: req.ip,
      actorRole: req.user.role,
      details: { name: facility.name, changed },
    });

    res.json({ facility });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A facility with this name already exists.' });
    }
    console.error('Error updating facility:', err.message);
    res.status(500).json({ error: 'Failed to update facility.' });
  }
});

module.exports = router;
