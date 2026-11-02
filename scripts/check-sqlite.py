import sqlite3
from pathlib import Path

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript(Path("migrations/0001_initial.sql").read_text())

# Runtime-added user metadata and stable numeric public IDs.
db.execute("ALTER TABLE users ADD COLUMN public_id INTEGER")
db.execute("ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0")
db.execute("CREATE UNIQUE INDEX idx_users_public_id ON users(public_id)")

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

# Limited inventory: stock never goes below zero or above its configured limit.
db.execute("ALTER TABLE items ADD COLUMN stock_sold INTEGER NOT NULL DEFAULT 0")
db.execute("INSERT INTO users (id,username,password_hash,password_salt,balance,public_id) VALUES (?,?,?,?,?,?)",
           ("test-third","TestThird","hash","salt",100,3))
db.execute("INSERT INTO items (id,name,category,price,image_url,is_for_sale,is_limited,stock_limit,stock_sold) VALUES (?,?,?,?,?,?,?,?,?)",
           ("limited-hat","Limited Hat","Hats",10,"https://example.com/limited.png",1,1,2,0))

def limited_purchase(user_id):
    db.execute("BEGIN IMMEDIATE")
    db.execute("""UPDATE items SET stock_sold=stock_sold+1
      WHERE id='limited-hat' AND is_for_sale=1
      AND (stock_limit=0 OR stock_sold<stock_limit)
      AND EXISTS (SELECT 1 FROM users WHERE id=? AND balance>=10)
      AND NOT EXISTS (SELECT 1 FROM inventory WHERE user_id=? AND item_id='limited-hat')""",
               (user_id,user_id))
    db.execute("UPDATE users SET balance=balance-10 WHERE id=? AND balance>=10 AND changes()=1",
               (user_id,))
    db.execute("""INSERT INTO inventory (id,user_id,item_id)
      SELECT ?,?,'limited-hat' WHERE changes()=1""",
               ("inv-"+user_id,user_id))
    db.execute("""INSERT INTO purchases (id,user_id,item_id,price)
      SELECT ?,?,'limited-hat',10 WHERE changes()=1""",
               ("purchase-"+user_id,user_id))
    changed = db.execute("SELECT changes()").fetchone()[0]
    db.commit()
    return changed == 1

assert limited_purchase("test-user")
assert limited_purchase("test-friend")
assert not limited_purchase("test-third")
assert db.execute("SELECT stock_sold FROM items WHERE id='limited-hat'").fetchone()[0] == 2
assert db.execute("SELECT COUNT(*) FROM inventory WHERE item_id='limited-hat'").fetchone()[0] == 2
assert db.execute("SELECT balance FROM users WHERE id='test-third'").fetchone()[0] == 100
print("PASS Limited stock cap and sold-out protection")

# Custom public User IDs are unique and changing an ID does not change the internal account key.
db.execute("UPDATE users SET public_id=rowid WHERE public_id IS NULL")
db.execute("UPDATE users SET public_id=501 WHERE id='test-user'")
db.execute("UPDATE users SET public_id=502 WHERE id='test-friend'")
db.execute("""UPDATE users SET public_id=502
 WHERE id='test-user' AND NOT EXISTS (SELECT 1 FROM users WHERE public_id=502 AND id<>'test-user')""")
assert db.execute("SELECT changes()").fetchone()[0] == 0
assert db.execute("SELECT id FROM users WHERE public_id=501").fetchone()[0] == "test-user"
assert db.execute("SELECT COUNT(*) FROM users WHERE public_id=502").fetchone()[0] == 1
print("PASS unique public User ID changes")
