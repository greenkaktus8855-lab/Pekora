import sqlite3
from pathlib import Path

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript(Path("migrations/0001_initial.sql").read_text())

db.execute("INSERT INTO users (id,username,password_hash,password_salt,balance) VALUES (?,?,?,?,?)",
           ("test-user","TestUser","hash","salt",100))
db.execute("INSERT INTO users (id,username,password_hash,password_salt,balance) VALUES (?,?,?,?,?)",
           ("test-friend","TestFriend","hash","salt",100))
db.execute("INSERT INTO items (id,name,category,price,image_url,is_for_sale) VALUES (?,?,?,?,?,?)",
           ("test-hat","Test Hat","Hats",25,"https://example.com/hat.png",1))

# Purchase transaction: debit, inventory and history must commit together.
db.execute("""UPDATE users SET balance=balance-?
 WHERE id=? AND balance>=?
 AND NOT EXISTS (SELECT 1 FROM inventory WHERE user_id=? AND item_id=?)
 AND EXISTS (SELECT 1 FROM items WHERE id=? AND is_for_sale=1)""",
           (25,"test-user",25,"test-user","test-hat","test-hat"))
db.execute("INSERT INTO inventory (id,user_id,item_id) SELECT ?,?,? WHERE changes()=1",
           ("inventory-row","test-user","test-hat"))
db.execute("INSERT INTO purchases (id,user_id,item_id,price) SELECT ?,?,?,? WHERE changes()=1",
           ("purchase-row","test-user","test-hat",25))
assert db.execute("SELECT balance FROM users WHERE id='test-user'").fetchone()[0] == 75
assert db.execute("SELECT COUNT(*) FROM inventory WHERE user_id='test-user'").fetchone()[0] == 1
assert db.execute("SELECT COUNT(*) FROM purchases WHERE user_id='test-user'").fetchone()[0] == 1
print("PASS purchase transaction")

# A duplicate purchase must not debit again.
db.execute("""UPDATE users SET balance=balance-?
 WHERE id=? AND balance>=?
 AND NOT EXISTS (SELECT 1 FROM inventory WHERE user_id=? AND item_id=?)
 AND EXISTS (SELECT 1 FROM items WHERE id=? AND is_for_sale=1)""",
           (25,"test-user",25,"test-user","test-hat","test-hat"))
assert db.execute("SELECT changes()").fetchone()[0] == 0
assert db.execute("SELECT balance FROM users WHERE id='test-user'").fetchone()[0] == 75
print("PASS duplicate purchase protection")

# Profile save recreates a missing profile row.
db.execute("""INSERT INTO profiles (user_id,description) VALUES (?,?)
 ON CONFLICT(user_id) DO UPDATE SET description=excluded.description""",
           ("test-user","Profile saved"))
assert db.execute("SELECT description FROM profiles WHERE user_id='test-user'").fetchone()[0] == "Profile saved"
print("PASS profile upsert")

# Reciprocal friend request acceptance creates both directions.
db.execute("INSERT INTO friends (user_id,friend_id,status) VALUES (?,?, 'PENDING')",
           ("test-friend","test-user"))
db.execute("UPDATE friends SET status='ACCEPTED' WHERE user_id=? AND friend_id=? AND status='PENDING'",
           ("test-friend","test-user"))
db.execute("""INSERT OR REPLACE INTO friends (user_id,friend_id,status)
 SELECT ?,?,'ACCEPTED' WHERE changes()=1""", ("test-user","test-friend"))
assert db.execute("SELECT COUNT(*) FROM friends WHERE status='ACCEPTED'").fetchone()[0] == 2
print("PASS reciprocal friendship transaction")

# Catalog cleanout hides items without deleting users, balances or inventory.
db.execute("CREATE TABLE site_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)")
db.execute("UPDATE items SET is_for_sale=0 WHERE is_for_sale=1")
db.execute("""INSERT OR IGNORE INTO site_settings (setting_key,setting_value)
 VALUES ('catalog_cleanout_2026_11_02','done')""")
assert db.execute("SELECT COUNT(*) FROM items WHERE is_for_sale=1").fetchone()[0] == 0
assert db.execute("SELECT COUNT(*) FROM inventory WHERE user_id='test-user'").fetchone()[0] == 1
assert db.execute("SELECT balance FROM users WHERE id='test-user'").fetchone()[0] == 75
print("PASS public catalog cleanout preserves ownership and balance")
