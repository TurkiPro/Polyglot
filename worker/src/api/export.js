/**
 * GET /api/export (§11) — everything the server holds about a user, as a file.
 *
 * The same shape the client writes in guest mode, so an export from either side imports
 * into the other (§1.5).
 */
import { config } from '../../../config/app.config.js';

export async function exportAll(env, user) {
  const [events, words] = await Promise.all([
    env.DB.prepare(
      `SELECT id, card_id, rating, ts, dur_ms FROM review_events
        WHERE user_id = ? ORDER BY received_at ASC`,
    )
      .bind(user.id)
      .all(),
    env.DB.prepare(
      `SELECT payload, updated_at, deleted FROM custom_words
        WHERE user_id = ? ORDER BY updated_at ASC`,
    )
      .bind(user.id)
      .all(),
  ]);

  return {
    app: config.identity.projectName,
    version: 1,
    exportedAt: new Date().toISOString(),
    language: config.pack.langPackV1,
    user: { id: user.id, displayName: user.displayName, provider: user.provider },
    events: (events.results ?? []).map((row) => {
      const event = { id: row.id, cardId: row.card_id, rating: row.rating, ts: row.ts };
      if (row.dur_ms !== null && row.dur_ms !== undefined) event.durMs = row.dur_ms;
      return event;
    }),
    customWords: (words.results ?? []).map((row) => ({
      ...JSON.parse(row.payload),
      updatedAt: row.updated_at,
      deleted: row.deleted === 1,
    })),
  };
}

/** The filename a browser should save it under. */
export const exportFilename = () =>
  `${config.identity.projectName}-export-${new Date().toISOString().slice(0, 10)}.json`;
