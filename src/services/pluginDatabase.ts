import { config } from "../../package.json";

/**
 * The plugin's one SQLite file, `meristema-external.sqlite` in the profile.
 * The external work cache and the saved graphs share it, so neither depends
 * on the other's lifecycle: hooks open it before either store initialises
 * and close it after both have let go.
 *
 * `Zotero.DBConnection` opens the file lazily on the first query, so the
 * constructor here is cheap and cannot fail on a missing file.
 */
let connection: _ZoteroTypes.DBConnection | null = null;
let opening: Promise<_ZoteroTypes.DBConnection> | null = null;

export function openPluginDatabase(): Promise<_ZoteroTypes.DBConnection> {
  if (connection) return Promise.resolve(connection);
  if (opening) return opening;
  opening = Promise.resolve()
    .then(() => {
      const created = new Zotero.DBConnection(`${config.addonRef}-external`);
      connection = created;
      return created;
    })
    .finally(() => {
      opening = null;
    });
  return opening;
}

export function getPluginDatabase(): _ZoteroTypes.DBConnection | null {
  return connection;
}

export async function closePluginDatabase(): Promise<void> {
  if (opening) await opening.catch(() => undefined);
  const current = connection;
  connection = null;
  if (current) await current.closeDatabase(true).catch(() => undefined);
}
