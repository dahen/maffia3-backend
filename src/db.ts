import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class Store {
  db: DatabaseSync;
  private depth = 0;
  constructor(path = process.env.MAFFIA_DB_PATH || resolve('data/maffia3.sqlite')) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, pin_hash TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0 CHECK(admin IN (0,1)));
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('test','live')), current_revision INTEGER REFERENCES revisions(id), forward_revision INTEGER REFERENCES revisions(id), automation_paused INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL REFERENCES games(id), parent_id INTEGER REFERENCES revisions(id), label TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), state_json TEXT NOT NULL CHECK(json_valid(state_json)), round INTEGER NOT NULL, phase INTEGER NOT NULL CHECK(phase BETWEEN 0 AND 3), created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS revisions_game_parent ON revisions(game_id,parent_id,id);
      CREATE TABLE IF NOT EXISTS navigation_choices (game_id TEXT NOT NULL REFERENCES games(id), parent_id INTEGER NOT NULL REFERENCES revisions(id), child_id INTEGER NOT NULL REFERENCES revisions(id), PRIMARY KEY(game_id,parent_id));
      CREATE TABLE IF NOT EXISTS room_reads (user_id TEXT NOT NULL REFERENCES users(id), game_id TEXT NOT NULL REFERENCES games(id), room_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(user_id,game_id,room_id));
      INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);
    `);
  }
  all<T>(sql: string, ...args: SQLInputValue[]): T[] { return this.db.prepare(sql).all(...args) as unknown as T[]; }
  one<T>(sql: string, ...args: SQLInputValue[]): T | undefined { return this.db.prepare(sql).get(...args) as unknown as T | undefined; }
  run(sql: string, ...args: SQLInputValue[]) { return this.db.prepare(sql).run(...args); }
  transaction<T>(work: () => T): T {
    const nested = this.depth > 0; const point = `nested_${this.depth++}`;
    try {
      this.db.exec(nested ? `SAVEPOINT ${point}` : 'BEGIN IMMEDIATE');
      try { const value = work(); this.db.exec(nested ? `RELEASE ${point}` : 'COMMIT'); return value; }
      catch (e) { this.db.exec(nested ? `ROLLBACK TO ${point}; RELEASE ${point}` : 'ROLLBACK'); throw e; }
    } finally { this.depth--; }
  }
  close() { this.db.close(); }
}
