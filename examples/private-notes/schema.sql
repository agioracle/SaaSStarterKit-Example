-- Test fixture matching private-notes.schema.ts. Do NOT copy this into drizzle/.
-- The installer adds the schema export. npm run db:generate creates the next migration + snapshot.
CREATE TABLE private_notes (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  pinned integer DEFAULT 0 NOT NULL,
  created_at integer NOT NULL
);
CREATE INDEX private_notes_owner_idx ON private_notes(user_id, created_at, id);
