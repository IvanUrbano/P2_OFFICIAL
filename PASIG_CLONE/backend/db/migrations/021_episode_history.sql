-- Case History entries for TB episodes: "new_episode" on a returning patient's new case,
-- "episode_linked" on each earlier episode of the same patient (services/episodes.js).
-- Re-created on every startup with the full list, so it is safe to run again.
ALTER TABLE case_history DROP CONSTRAINT IF EXISTS case_history_change_type_check;
ALTER TABLE case_history ADD CONSTRAINT case_history_change_type_check CHECK (change_type IN
  ('created', 'updated', 'merged', 'transferred', 'status_changed', 'deleted', 'restored',
   'new_episode', 'episode_linked'));
