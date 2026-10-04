-- Migration 023: Barangay-based staff, expanded health facilities, case tracking fields
--
-- SAFE / ADDITIVE ONLY: every statement adds a column, table, index or constraint,
-- or fills a NEW column. No row is deleted and no existing value is changed.
-- Idempotent: safe to run on every startup.
--
-- 1. barangays        — numeric id (users/facilities reference it), city, PSGC code, active flag.
--                       `name` stays the primary key: ~13 tables reference barangays(name).
-- 2. users            — barangay_id. Staff are assigned to a barangay; admins need none.
--                       facility_id is kept (optional) for transfers and history.
-- 3. health_facilities — ownership (public/private), category (health center, hospital,
--                       clinic, ...), external/reference flags, contact details.
--                       barangay_name becomes optional, but only for external facilities.
-- 4. tb_cases         — source record ID, source case ID, match status; plus case_history
--                       and case_review_history tables. Patient # / Case ID (patient_no,
--                       case_no) stay nullable until the identity scheme is confirmed.

-- ==================== 1. BARANGAYS ====================

ALTER TABLE barangays ADD COLUMN IF NOT EXISTS id INTEGER;
CREATE SEQUENCE IF NOT EXISTS barangays_id_seq OWNED BY barangays.id;

-- Number existing barangays alphabetically (only rows without an id yet).
UPDATE barangays b
SET id = s.new_id
FROM (
  SELECT name,
         (SELECT COALESCE(MAX(id), 0) FROM barangays) + ROW_NUMBER() OVER (ORDER BY name) AS new_id
  FROM barangays
  WHERE id IS NULL
) s
WHERE b.name = s.name;

SELECT setval('barangays_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM barangays), 1));
ALTER TABLE barangays ALTER COLUMN id SET DEFAULT nextval('barangays_id_seq');
ALTER TABLE barangays ALTER COLUMN id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS barangays_id_key ON barangays(id);

ALTER TABLE barangays ADD COLUMN IF NOT EXISTS city TEXT DEFAULT 'Pasig City';
ALTER TABLE barangays ADD COLUMN IF NOT EXISTS psgc_code TEXT;
ALTER TABLE barangays ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE barangays ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE barangays ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ==================== 2. USERS ====================

ALTER TABLE users ADD COLUMN IF NOT EXISTS barangay_id INTEGER
  REFERENCES barangays(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_barangay ON users(barangay_id);

-- Existing staff were facility-assigned: carry their facility's barangay over to
-- the new column. Admins are left alone (no barangay required).
UPDATE users u
SET barangay_id = b.id
FROM health_facilities h
JOIN barangays b ON b.name = h.barangay_name
WHERE u.facility_id = h.id
  AND u.role = 'staff'
  AND u.barangay_id IS NULL;

-- "Staff must have a barangay" is enforced by the account API, not a CHECK
-- constraint: a CHECK would also fire on unrelated updates (login counters,
-- password changes) of older staff rows that have no barangay yet.

-- ==================== 3. HEALTH FACILITIES ====================

ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS barangay_id INTEGER
  REFERENCES barangays(id) ON DELETE SET NULL;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS ownership TEXT;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS facility_category TEXT;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS is_external BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS is_reference BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS facility_code TEXT;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS city TEXT DEFAULT 'Pasig City';
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS contact_number TEXT;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- External facilities (outside Pasig, e.g. a referral hospital in another city) have no
-- Pasig barangay; Pasig facilities still must have one (checked below).
ALTER TABLE health_facilities ALTER COLUMN barangay_name DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'health_facilities_ownership_check') THEN
    ALTER TABLE health_facilities ADD CONSTRAINT health_facilities_ownership_check
      CHECK (ownership IS NULL OR ownership IN ('public', 'private'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'health_facilities_category_check') THEN
    ALTER TABLE health_facilities ADD CONSTRAINT health_facilities_category_check
      CHECK (facility_category IS NULL OR facility_category IN
        ('health_center', 'hospital', 'clinic', 'laboratory', 'treatment_center', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'health_facilities_location_check') THEN
    ALTER TABLE health_facilities ADD CONSTRAINT health_facilities_location_check
      CHECK (is_external OR barangay_name IS NOT NULL);
  END IF;

  -- Deleting a barangay used to CASCADE-delete its facilities (and silently unassign
  -- users and break case references). Facilities are reference/history data: block
  -- the delete instead, and follow renames.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'health_facilities_barangay_name_fkey' AND confdeltype = 'c'
  ) THEN
    ALTER TABLE health_facilities DROP CONSTRAINT health_facilities_barangay_name_fkey;
    ALTER TABLE health_facilities ADD CONSTRAINT health_facilities_barangay_name_fkey
      FOREIGN KEY (barangay_name) REFERENCES barangays(name)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

-- (name, barangay_name) is already unique; external facilities have no barangay, so
-- keep their names unique on their own.
CREATE UNIQUE INDEX IF NOT EXISTS health_facilities_external_name_key
  ON health_facilities (lower(name)) WHERE barangay_name IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS health_facilities_code_key
  ON health_facilities (facility_code) WHERE facility_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_health_facilities_barangay_id ON health_facilities(barangay_id);

-- Fill the new columns for existing facilities (new columns only).
UPDATE health_facilities h
SET barangay_id = b.id
FROM barangays b
WHERE b.name = h.barangay_name AND h.barangay_id IS NULL;

-- HC = city health center, PC = puericulture center: both public, both health centers.
-- Other existing types (ITC, Floodway) are left unclassified for an admin to set.
UPDATE health_facilities
SET facility_category = 'health_center'
WHERE facility_category IS NULL AND facility_type IN ('HC', 'PC');
UPDATE health_facilities
SET ownership = 'public'
WHERE ownership IS NULL AND facility_type IN ('HC', 'PC');

-- ==================== 4. CASE TRACKING ====================

-- source_record_id: the record's ID in the system it came from (PASIG validated row id).
-- source_case_id:   the case number printed in the source file (e.g. ITIS Lite case no.).
-- match_status:     possible-match review state carried from PASIG.
-- validation_status, batch_id (import batch), case_no (Case ID) and patient_no (Patient #)
-- already exist; case_no / patient_no remain nullable until the identity scheme is confirmed.
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS source_record_id TEXT;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS source_case_id TEXT;
ALTER TABLE tb_cases ADD COLUMN IF NOT EXISTS match_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_cases_match_status_check') THEN
    ALTER TABLE tb_cases ADD CONSTRAINT tb_cases_match_status_check
      CHECK (match_status IS NULL OR match_status IN ('none', 'pending', 'resolved'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tb_cases_source_record ON tb_cases(source_record_id)
  WHERE source_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tb_cases_source_case ON tb_cases(source_case_id)
  WHERE source_case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tb_cases_patient_no ON tb_cases(patient_no)
  WHERE patient_no IS NOT NULL;

-- Every change to a case over time. tb_case_id has NO foreign key on purpose: history
-- must survive when a case row is removed (e.g. an import batch is undone).
CREATE TABLE IF NOT EXISTS case_history (
  id BIGSERIAL PRIMARY KEY,
  tb_case_id BIGINT,
  case_no TEXT,
  patient_no TEXT,
  batch_id UUID,
  change_type TEXT NOT NULL CHECK (change_type IN
    ('created', 'updated', 'merged', 'transferred', 'status_changed', 'deleted', 'restored')),
  changed_fields JSONB,             -- {"field": {"old": ..., "new": ...}}
  source TEXT CHECK (source IS NULL OR source IN
    ('import', 'webhook', 'manual', 'transfer', 'review', 'system')),
  changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_case_history_case ON case_history(tb_case_id);
CREATE INDEX IF NOT EXISTS idx_case_history_case_no ON case_history(case_no) WHERE case_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_history_changed_at ON case_history(changed_at);

-- Human review decisions (validation, possible match, duplicate, barangay assignment...).
CREATE TABLE IF NOT EXISTS case_review_history (
  id BIGSERIAL PRIMARY KEY,
  tb_case_id BIGINT,
  case_no TEXT,
  review_type TEXT NOT NULL CHECK (review_type IN
    ('validation', 'match', 'duplicate', 'assignment', 'transfer', 'other')),
  decision TEXT,
  previous_status TEXT,
  new_status TEXT,
  notes TEXT,
  reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_case_review_history_case ON case_review_history(tb_case_id);
CREATE INDEX IF NOT EXISTS idx_case_review_history_case_no ON case_review_history(case_no) WHERE case_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_review_history_reviewed_at ON case_review_history(reviewed_at);
