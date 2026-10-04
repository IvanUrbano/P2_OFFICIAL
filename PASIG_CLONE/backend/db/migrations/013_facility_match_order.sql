-- Migration 013: facility matching — strip program tags, exact registry name first.
--
-- Imported facility names carry the recording program as a suffix ("ROSARIO HEALTH
-- CENTER - IDOTS", "… - MTBN") that says nothing about the facility itself. Dropping
-- that suffix inside norm_facility() lets ONE clean alias ("ROSARIO HEALTH CENTER")
-- resolve every tagged variant — past and future imports alike — and lets a tagged
-- text that matches a registry name exactly ("ROSARIO HC - IDOTS") resolve with no
-- alias at all. Matching order becomes: exact registry name → alias → Needs
-- Assignment (the spec order; the previous definition checked aliases first).

CREATE OR REPLACE FUNCTION norm_facility(p TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    regexp_replace(lower(coalesce(p, '')), '\s*-\s*(idots|mtbn)\s*$', '', 'g'),
    '[^a-z0-9]', '', 'g'
  )
$$;

CREATE OR REPLACE FUNCTION facility_ref_id(p TEXT) RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN norm_facility(p) = '' THEN NULL ELSE COALESCE(
    (SELECT id FROM facility_ref WHERE norm_name = norm_facility(p) ORDER BY id LIMIT 1),
    (SELECT facility_id FROM facility_aliases WHERE alias_norm = norm_facility(p))
  ) END
$$;

-- Recompute stored keys under the new normalizer (registry names carry no tag, so
-- this is a no-op for them today; it keeps the invariant true after a future rename).
UPDATE facility_ref SET norm_name = norm_facility(name)
 WHERE norm_name IS DISTINCT FROM norm_facility(name);

-- Aliases: park every key behind a '~' prefix (norm_facility can never emit '~', so
-- no mid-update collision is possible), drop rows that now normalize to the same key
-- — keeping the earliest mapping — then install the new keys.
UPDATE facility_aliases SET alias_norm = '~' || alias_norm;

WITH ranked AS (
  SELECT ctid, ROW_NUMBER() OVER (PARTITION BY norm_facility(alias_text)
                                   ORDER BY created_at, alias_norm) AS rn
  FROM facility_aliases
)
DELETE FROM facility_aliases a
 USING ranked r
WHERE a.ctid = r.ctid AND r.rn > 1;

UPDATE facility_aliases SET alias_norm = norm_facility(alias_text);

-- norm_facility() changed: the expression indexes hold keys built from the PREVIOUS
-- body, and PostgreSQL inlines an SQL function into the index expression at creation
-- time — REINDEX re-evaluates that stored (old) expression, so it does NOT pick up a
-- new body. The indexes have to be dropped and rebuilt to re-read norm_facility().
DO $$
BEGIN
  IF to_regclass('idx_validated_cases_treatment_facility_norm') IS NOT NULL THEN
    DROP INDEX idx_validated_cases_treatment_facility_norm;
  END IF;
  IF to_regclass('idx_validated_cases_screening_facility_norm') IS NOT NULL THEN
    DROP INDEX idx_validated_cases_screening_facility_norm;
  END IF;
END $$;
CREATE INDEX idx_validated_cases_treatment_facility_norm
  ON validated_tb_cases (norm_facility(treatment_facility));
CREATE INDEX idx_validated_cases_screening_facility_norm
  ON validated_tb_cases (norm_facility(screening_facility));

-- Re-resolve case facility ids under the new rules (only rows that change; the raw
-- facility text on each row is never touched).
WITH m AS (
  SELECT DISTINCT treatment_facility AS t, facility_ref_id(treatment_facility) AS fid
  FROM validated_tb_cases WHERE treatment_facility IS NOT NULL
)
UPDATE validated_tb_cases v SET treatment_facility_id = m.fid
FROM m WHERE v.treatment_facility = m.t AND v.treatment_facility_id IS DISTINCT FROM m.fid;

WITH m AS (
  SELECT DISTINCT screening_facility AS t, facility_ref_id(screening_facility) AS fid
  FROM validated_tb_cases WHERE screening_facility IS NOT NULL
)
UPDATE validated_tb_cases v SET screening_facility_id = m.fid
FROM m WHERE v.screening_facility = m.t AND v.screening_facility_id IS DISTINCT FROM m.fid;
