-- Medicine pickup schedules for patients on treatment (Medication Schedule page,
-- routes/medication.js, services/medicationSchedule.js).
--
-- A schedule is a pickup at the health center every `interval_days` days from
-- start_date to end_date; `medicines` lists what is handed out at each pickup
-- ([{ name, quantity, unit, instructions }], editable — later pickups use the new list).
-- Only pickups a nurse RECORDS are stored (medication_pickups); a pickup still not
-- collected PICKUP_GRACE_DAYS after its date counts as missed. One active schedule per
-- case; a stopped one is kept as history.
CREATE TABLE IF NOT EXISTS medication_schedules (
  id BIGSERIAL PRIMARY KEY,
  validated_case_id BIGINT NOT NULL REFERENCES validated_tb_cases(id) ON DELETE CASCADE,
  medicines JSONB NOT NULL DEFAULT '[]'::jsonb,
  interval_days INTEGER NOT NULL CHECK (interval_days BETWEEN 1 AND 60),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL CHECK (end_date >= start_date),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_by INTEGER,
  stopped_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_medication_schedule_active
  ON medication_schedules(validated_case_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS medication_pickups (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT NOT NULL REFERENCES medication_schedules(id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('collected', 'missed')),
  collected_on DATE,
  medicines JSONB,
  recorded_by INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (schedule_id, due_date)
);
