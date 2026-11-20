import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { paths } from '../config/paths.js';
import { migrate } from './migrations.js';

export type Db = Database.Database;

/**
 * Open (or reuse) a database connection and bring its schema up to date.
 * Stores accept either a path or an existing connection so the app can share
 * one connection and tests can use ':memory:'.
 */
export function openDatabase(pathOrConnection: string | Db = paths.database): Db {
  let db: Db;
  if (typeof pathOrConnection === 'string') {
    if (pathOrConnection !== ':memory:') {
      mkdirSync(dirname(pathOrConnection), { recursive: true });
    }
    db = new Database(pathOrConnection);
    db.pragma('journal_mode = WAL');
  } else {
    db = pathOrConnection;
  }

  migrate(db);
  return db;
}
