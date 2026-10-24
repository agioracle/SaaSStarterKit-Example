import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { user } from './auth.schema';

export const privateNotes = sqliteTable('private_notes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  pinned: integer('pinned').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('private_notes_owner_idx').on(table.userId, table.createdAt, table.id)]);
